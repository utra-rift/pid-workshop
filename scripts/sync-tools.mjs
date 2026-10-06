#!/usr/bin/env node
// Copies the in-browser toolchains into place.
//
//   public/vendor/  small files that must be same-origin (worker scripts, Pyodide).
//                   Served with the app.
//   tools-dist/     the big binaries (clang, clangd's wasm). Served at /tools in dev
//                   and preview; production loads them from VITE_TOOLS_URL (R2).
//
// Versions here must match src/tools.ts.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// Some packages don't export package.json, so look them up on disk directly.
const pkgDir = (name) => path.join(root, "node_modules", name);
const version = (name) => JSON.parse(readFileSync(path.join(pkgDir(name), "package.json"), "utf8")).version;

const vendor = path.join(root, "public/vendor");
const tools = path.join(root, "tools-dist");

function copy(from, toDir, files) {
	mkdirSync(toDir, { recursive: true });
	for (const file of files) {
		const src = path.join(from, file);
		const dest = path.join(toDir, file);
		if (existsSync(dest) && statSync(dest).size === statSync(src).size) continue;
		copyFileSync(src, dest);
	}
}

// Pyodide: the runtime that runs students' Python.
const pyodide = version("pyodide");
copy(pkgDir("pyodide"), path.join(vendor, "pyodide", pyodide), [
	"pyodide.mjs",
	"pyodide.asm.mjs",
	"pyodide.asm.wasm",
	"python_stdlib.zip",
	"pyodide-lock.json",
]);

// basedpyright: the Python language server, as one worker script.
const pyright = version("browser-basedpyright");
copy(path.join(pkgDir("browser-basedpyright"), "dist"), path.join(vendor, "basedpyright", pyright), ["pyright.worker.js"]);

// clang: compiles students' C++ to WebAssembly.
const clang = version("@yowasp/clang");
const clangGen = path.join(pkgDir("@yowasp/clang"), "gen");
copy(clangGen, path.join(tools, "clang", clang), readdirSync(clangGen));

// clangd: the C++ language server. There's no npm package for a current
// WebAssembly build, so for now this uses the build published by
// clangd-in-browser (MIT, https://github.com/Guyutongxue/clangd-in-browser),
// LLVM 21.1.0. scripts/clangd/build.sh builds our own; see README.
const CLANGD = {
	version: "21.1.0",
	base: "https://clangd.guyutongxue.site/wasm",
	files: {
		"clangd.js": "a7ff1c588eb5374783bbda84d949b92b8027c2381c786072448b96eba90c7027",
		"clangd.wasm": "0d71e7a7f8e6dd369cb2a0b22cc4016d649f370e5b905adb6092536deb0ee019",
	},
};
const clangdJs = path.join(vendor, "clangd", CLANGD.version, "clangd.js");
const clangdWasm = path.join(tools, "clangd", CLANGD.version, "clangd.wasm");

async function fetchTo(url, dest, sha256) {
	if (existsSync(dest)) return;
	const local = process.env.CLANGD_DIR && path.join(process.env.CLANGD_DIR, path.basename(dest));
	let bytes;
	if (local && existsSync(local)) {
		bytes = readFileSync(local);
	} else {
		console.log(`Downloading ${url}`);
		const response = await fetch(url);
		if (!response.ok) throw new Error(`${url}: ${response.status}`);
		bytes = Buffer.from(await response.arrayBuffer());
	}
	const hash = createHash("sha256").update(bytes).digest("hex");
	if (sha256 && hash !== sha256) throw new Error(`${path.basename(dest)}: expected sha256 ${sha256}, got ${hash}`);
	mkdirSync(path.dirname(dest), { recursive: true });
	writeFileSync(dest, bytes);
}

await fetchTo(`${CLANGD.base}/clangd.js`, clangdJs, CLANGD.files["clangd.js"]);
await fetchTo(`${CLANGD.base}/clangd.wasm`, clangdWasm, CLANGD.files["clangd.wasm"]);

console.log(`Tools ready: pyodide ${pyodide}, basedpyright ${pyright}, clang ${clang}, clangd ${CLANGD.version}`);
