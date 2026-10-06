// The files around the student's controller.cpp. Shared by the compiler,
// the language server and the editor.

/** What students #include. Shown read-only in the editor. */
export const ROBOT_H = `#pragma once

// The robot calls your controller 200 times a second.
// angle and target are in degrees, dt is in seconds. Return motor volts.
extern "C" double controller(double angle, double target, double dt);

// Adds a line called \`name\` to the response graph.
extern "C" __attribute__((import_module("robot"), import_name("plot")))
void plot(const char* name, double value);

// Returns x limited to the range lo..hi.
inline double clamp(double x, double lo, double hi) {
  return x < lo ? lo : (x > hi ? hi : x);
}

// Converts degrees to radians, for std::cos and std::sin.
inline double toRadians(double degrees) {
  return degrees * 3.14159265358979323846 / 180.0;
}
`;

/** Included before the student's file. Makes printf show up line by line. */
export const PRELUDE_H = `#include <stdio.h>
__attribute__((constructor)) static void robot_unbuffer_stdout() {
  setvbuf(stdout, nullptr, _IONBF, 0);
}
`;

export const FILE = "controller.cpp";

/** Flags shared by the compiler and the language server. */
export const CPP_FLAGS = [
	"--target=wasm32-wasip1",
	"-std=c++20",
	"-fno-exceptions",
	"-include",
	"prelude.h",
	"-Wall",
];

/**
 * Flags for clangd. Its WebAssembly build embeds a WASI sysroot at /usr/include,
 * so the include paths point there. Same language settings as CPP_FLAGS.
 */
export const CLANGD_FLAGS = [
	"-xc++",
	"--target=wasm32-wasi",
	"-std=c++20",
	"-fno-exceptions",
	"-include",
	"/workspace/prelude.h",
	"-Wall",
	"-isystem/usr/include/c++/v1",
	"-isystem/usr/include/wasm32-wasi/c++/v1",
	"-isystem/usr/include",
	"-isystem/usr/include/wasm32-wasi",
];
