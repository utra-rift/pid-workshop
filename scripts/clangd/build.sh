#!/usr/bin/env bash
# Builds clangd for the browser (WebAssembly, pthreads, Asyncify).
#
# Adapted from clangd-in-browser's build.sh (MIT, see LICENSE in this folder).
# Their CI builds the same thing on ubuntu-latest; this script has not been run
# here yet. It needs Linux or macOS with git, cmake, ninja, python3 and about
# 30 GB of disk. Expect an hour or more: it builds LLVM's tablegen natively,
# then clangd twice with Emscripten (once to get the compiler headers).
#
#   scripts/clangd/build.sh
#   # then copy out/clangd.js to public/vendor/clangd/<LLVM_VER>/
#   # and out/clangd.wasm to tools-dist/clangd/<LLVM_VER>/ (and the R2 bucket),
#   # and update the version and sha256s in scripts/sync-tools.mjs and src/tools.ts.
set -euo pipefail

EMSDK_VER=4.0.22
WASI_SDK_VER=29.0
WASI_SDK_VER_MAJOR=29
LLVM_VER=${LLVM_VER:-21.1.0}
LLVM_VER_MAJOR=${LLVM_VER%%.*}

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT_DIR=${ROOT_DIR:-$HERE/.build}
OUT_DIR=$HERE/out
mkdir -p "$ROOT_DIR" "$OUT_DIR"
cd "$ROOT_DIR"

# 1. Emscripten
[[ -d emsdk ]] || git clone --branch $EMSDK_VER --depth 1 https://github.com/emscripten-core/emsdk
(cd emsdk && ./emsdk install $EMSDK_VER && ./emsdk activate $EMSDK_VER)
# shellcheck disable=SC1091
source emsdk/emsdk_env.sh

# 2. WASI sysroot: the C and C++ headers clangd embeds at /usr/include.
if [[ ! -d wasi-sysroot-$WASI_SDK_VER ]]; then
  curl -fsSL "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-$WASI_SDK_VER_MAJOR/wasi-sysroot-$WASI_SDK_VER.tar.gz" | tar -xz
fi

# 3. LLVM
[[ -d llvm-project ]] || git clone --branch "llvmorg-$LLVM_VER" --depth 1 https://github.com/llvm/llvm-project
cd llvm-project

cmake -G Ninja -S llvm -B build-native -DCMAKE_BUILD_TYPE=Release -DLLVM_ENABLE_PROJECTS=clang
cmake --build build-native --target llvm-tblgen clang-tblgen

# clangd blocks on stdin; the patch makes it await Module.stdinReady() instead.
if [[ ! -f .patched-wait-stdin ]]; then
  git apply "$HERE/wait_stdin.patch" && touch .patched-wait-stdin
fi

COMMON_FLAGS=(
  -DCMAKE_BUILD_TYPE=MinSizeRel
  -DLLVM_TARGET_ARCH=wasm32-emscripten
  -DLLVM_DEFAULT_TARGET_TRIPLE=wasm32-wasi
  -DLLVM_TARGETS_TO_BUILD=WebAssembly
  "-DLLVM_ENABLE_PROJECTS=clang;clang-tools-extra"
  "-DLLVM_TABLEGEN=$PWD/build-native/bin/llvm-tblgen"
  "-DCLANG_TABLEGEN=$PWD/build-native/bin/clang-tblgen"
  -DLLVM_BUILD_STATIC=ON
  -DLLVM_INCLUDE_EXAMPLES=OFF
  -DLLVM_INCLUDE_TESTS=OFF
  -DLLVM_ENABLE_BACKTRACES=OFF
  -DLLVM_ENABLE_UNWIND_TABLES=OFF
  -DLLVM_ENABLE_CRASH_OVERRIDES=OFF
  -DCLANG_ENABLE_STATIC_ANALYZER=OFF
  -DLLVM_ENABLE_TERMINFO=OFF
  -DLLVM_ENABLE_PIC=OFF
  -DLLVM_ENABLE_ZLIB=OFF
  -DCLANG_ENABLE_ARCMT=OFF
)

# First pass: only to produce clang's builtin headers.
emcmake cmake -G Ninja -S llvm -B build \
  -DCMAKE_CXX_FLAGS="-pthread -Dwait4=__syscall_wait4" \
  -DCMAKE_EXE_LINKER_FLAGS="-pthread -s ENVIRONMENT=worker -s NO_INVOKE_RUN" \
  "${COMMON_FLAGS[@]}"
cmake --build build --target clangd
cp -r "build/lib/clang/$LLVM_VER_MAJOR/include/"* "$ROOT_DIR/wasi-sysroot-$WASI_SDK_VER/include/"

# Second pass: the real thing, with the sysroot headers embedded.
emcmake cmake -G Ninja -S llvm -B build \
  -DCMAKE_CXX_FLAGS="-pthread -Dwait4=__syscall_wait4" \
  -DCMAKE_EXE_LINKER_FLAGS="-pthread -s ENVIRONMENT=worker -s NO_INVOKE_RUN -s EXIT_RUNTIME -s INITIAL_MEMORY=2GB -s ALLOW_MEMORY_GROWTH -s MAXIMUM_MEMORY=4GB -s STACK_SIZE=256kB -s EXPORTED_RUNTIME_METHODS=FS,callMain -s MODULARIZE -s EXPORT_ES6 -s WASM_BIGINT -s ASSERTIONS -s ASYNCIFY -s PTHREAD_POOL_SIZE='Math.max(navigator.hardwareConcurrency, 8)' --embed-file=$ROOT_DIR/wasi-sysroot-$WASI_SDK_VER/include@/usr/include" \
  "${COMMON_FLAGS[@]}"
cmake --build build --target clangd

cp build/bin/clangd.js build/bin/clangd.wasm "$OUT_DIR/"
shasum -a 256 "$OUT_DIR"/clangd.*
