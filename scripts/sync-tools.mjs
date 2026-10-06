#!/usr/bin/env node
// Copies the in-browser toolchains into public/vendor/, which ships with the app.
//
// The three big binaries (clang's wasm and its header tar, clangd's wasm) are
// written gzipped: that brings each one under 25 MiB, the per-file limit on
// Cloudflare Workers, and Vercel serves them as is. The workers inflate them
// with DecompressionStream. Everything else is copied unchanged.
//
// Versions here must match src/tools.ts. Runs before `pnpm dev` and `pnpm build`.

import { createHash } from "node:crypto";
import {
	copyFileSync,
	createReadStream,
	createWriteStream,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// Some packages don't export package.json, so look them up on disk directly.
const pkgDir = (name) => path.join(root, "node_modules", name);
const version = (name) => JSON.parse(readFileSync(path.join(pkgDir(name), "package.json"), "utf8")).version;

const vendor = path.join(root, "public/vendor");
const cache = path.join(root, "node_modules/.cache/learn-pid");
const MAX_FILE = 25 * 1024 * 1024;

function copy(from, toDir, files) {
	mkdirSync(toDir, { recursive: true });
	for (const file of files) {
		const src = path.join(from, file);
		const dest = path.join(toDir, file);
		if (existsSync(dest) && statSync(dest).size === statSync(src).size) continue;
		copyFileSync(src, dest);
	}
}

/** Writes `${dest}.gz`, skipping the work when it's already there and newer than the source. */
async function gzip(src, dest) {
	const out = `${dest}.gz`;
	if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) return;
	mkdirSync(path.dirname(out), { recursive: true });
	await pipeline(createReadStream(src), createGzip({ level: 9 }), createWriteStream(`${out}.tmp`));
	renameSync(`${out}.tmp`, out);
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
const clangDir = path.join(vendor, "clang", clang);
const CLANG_GZIPPED = ["llvm.core.wasm", "llvm-resources.tar"];
copy(
	clangGen,
	clangDir,
	readdirSync(clangGen).filter((file) => !CLANG_GZIPPED.includes(file)),
);
for (const file of CLANG_GZIPPED) await gzip(path.join(clangGen, file), path.join(clangDir, file));

// clangd: the C++ language server. There's no npm package for a current
// WebAssembly build, so for now this uses the build published by
// clangd-in-browser (MIT, https://github.com/Guyutongxue/clangd-in-browser),
// LLVM 21.1.0, pinned by sha256. scripts/clangd/build.sh builds our own; see README.
const CLANGD = {
	version: "21.1.0",
	base: "https://clangd.guyutongxue.site/wasm",
	files: {
		"clangd.js": "a7ff1c588eb5374783bbda84d949b92b8027c2381c786072448b96eba90c7027",
		"clangd.wasm": "0d71e7a7f8e6dd369cb2a0b22cc4016d649f370e5b905adb6092536deb0ee019",
	},
};

/** Downloads a clangd file into the cache once, checking its sha256. */
async function download(name) {
	const dest = path.join(cache, "clangd", CLANGD.version, name);
	if (existsSync(dest)) return dest;
	const local = process.env.CLANGD_DIR && path.join(process.env.CLANGD_DIR, name);
	let bytes;
	if (local && existsSync(local)) {
		bytes = readFileSync(local);
	} else {
		console.log(`Downloading ${CLANGD.base}/${name}`);
		const response = await fetch(`${CLANGD.base}/${name}`);
		if (!response.ok) throw new Error(`${CLANGD.base}/${name}: ${response.status}`);
		bytes = Buffer.from(await response.arrayBuffer());
	}
	const hash = createHash("sha256").update(bytes).digest("hex");
	if (hash !== CLANGD.files[name]) throw new Error(`${name}: expected sha256 ${CLANGD.files[name]}, got ${hash}`);
	mkdirSync(path.dirname(dest), { recursive: true });
	writeFileSync(dest, bytes);
	return dest;
}

const clangdDir = path.join(vendor, "clangd", CLANGD.version);
const clangdJs = await download("clangd.js");
copy(path.dirname(clangdJs), clangdDir, ["clangd.js"]);
await gzip(await download("clangd.wasm"), path.join(clangdDir, "clangd.wasm"));

// Every file has to fit a static host's per-file limit.
const tooBig = readdirSync(vendor, { recursive: true })
	.map((file) => path.join(vendor, String(file)))
	.filter((file) => statSync(file).isFile() && statSync(file).size > MAX_FILE);
if (tooBig.length) {
	throw new Error(`Over 25 MiB, too big for static hosting: ${tooBig.map((f) => path.relative(root, f)).join(", ")}`);
}

console.log(`Tools ready: pyodide ${pyodide}, basedpyright ${pyright}, clang ${clang}, clangd ${CLANGD.version}`);
