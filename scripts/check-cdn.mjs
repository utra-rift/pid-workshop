#!/usr/bin/env node
// Checks the toolchains on the CDN the way a browser on the site loads them.
// For every file in vendor/: it's there at the same size, with the right type,
// cached as immutable, and readable from another origin. The CORS header has
// to be there even after the edge has cached a response to a request with no
// Origin, which is the case that breaks if the edge caches without it.
//
//   node scripts/check-cdn.mjs [baseUrl]

import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendor = path.join(root, "vendor");
const base = (process.argv[2] ?? "https://cdn2.evanyu.dev/learn-pid").replace(/\/$/, "");
const ORIGIN = "https://pid-workshop.vercel.app";
const TYPES = {
	".js": "text/javascript",
	".mjs": "text/javascript",
	".wasm": "application/wasm",
	".json": "application/json",
	".zip": "application/zip",
	".gz": "application/gzip",
};

const files = readdirSync(vendor, { recursive: true })
	.map(String)
	.filter((file) => statSync(path.join(vendor, file)).isFile())
	.sort();

let failed = 0;
for (const file of files) {
	const url = `${base}/${file.split(path.sep).join("/")}`;
	const problems = [];
	// First without an Origin, as a crawler or curl would, then as the site.
	await fetch(url, { method: "HEAD", headers: { "accept-encoding": "identity" } });
	const response = await fetch(url, {
		method: "HEAD",
		headers: { origin: ORIGIN, "accept-encoding": "identity" },
	});
	const h = (name) => response.headers.get(name) ?? "";
	if (response.status !== 200) problems.push(`HTTP ${response.status}`);
	else {
		const size = statSync(path.join(vendor, file)).size;
		if (h("content-length") && Number(h("content-length")) !== size)
			problems.push(`size ${h("content-length")}, expected ${size}`);
		const type = TYPES[path.extname(file)] ?? "application/octet-stream";
		if (!h("content-type").startsWith(type)) problems.push(`type "${h("content-type")}", expected ${type}`);
		if (!h("cache-control").includes("immutable")) problems.push(`cache-control "${h("cache-control")}"`);
		const allow = h("access-control-allow-origin");
		if (allow !== "*" && allow !== ORIGIN) problems.push(`no CORS header for ${ORIGIN} (got "${allow}")`);
	}
	if (problems.length) failed++;
	console.log(`${problems.length ? "FAIL" : "PASS"} ${file}${problems.length ? `: ${problems.join("; ")}` : ""}`);
}

// Compression on the way out, for the files that aren't already gzipped.
const wasm = await fetch(`${base}/pyodide/314.0.7/pyodide.asm.wasm`, {
	headers: { origin: ORIGIN, "accept-encoding": "br, gzip" },
});
await wasm.body?.cancel();
console.log(`info pyodide.asm.wasm is sent ${wasm.headers.get("content-encoding") || "uncompressed"}, cf-cache-status ${wasm.headers.get("cf-cache-status") ?? "none"}`);

console.log(failed ? `${failed} of ${files.length} files have problems.` : `All ${files.length} files are ready on ${base}.`);
process.exit(failed ? 1 : 0);
