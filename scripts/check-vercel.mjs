#!/usr/bin/env node
// Checks a Vercel build before deploying:
//
// 1. Every static file gets COOP/COEP. Vercel applies the first matching route
//    in .vercel/output/config.json (unless it says "continue"), so a route for
//    /assets without the headers silently drops them, and workers then won't start.
// 2. The server function runs the way Vercel runs it: from a folder with no
//    project node_modules above it, so a package the bundle forgot to include
//    fails here instead of in production.
//
//   NITRO_PRESET=vercel pnpm build && node scripts/check-vercel.mjs

import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const fn = path.join(root, ".vercel/output/functions/__server.func");
if (!existsSync(fn)) {
	console.error("No Vercel build found. Run: NITRO_PRESET=vercel pnpm build");
	process.exit(1);
}

let failed = 0;

// 1. Headers on static files, using Vercel's first-match route semantics.
const config = JSON.parse(readFileSync(path.join(root, ".vercel/output/config.json"), "utf8"));
function headersFor(urlPath) {
	const headers = {};
	for (const route of config.routes) {
		if (route.handle) break;
		if (!new RegExp(`^${route.src}$`).test(urlPath)) continue;
		for (const [key, value] of Object.entries(route.headers ?? {})) headers[key.toLowerCase()] = value;
		if (!route.continue) break;
	}
	return headers;
}
const staticDir = path.join(root, ".vercel/output/static");
const files = readdirSync(staticDir, { recursive: true })
	.map((file) => `/${String(file).split(path.sep).join("/")}`)
	.filter((file) => /\.(m?js|wasm|html|css)$/.test(file));
const missing = files.filter((file) => {
	const h = headersFor(file);
	return h["cross-origin-embedder-policy"] !== "require-corp" || h["cross-origin-opener-policy"] !== "same-origin";
});
if (missing.length) failed++;
console.log(
	`${missing.length ? "FAIL" : "PASS"} COOP/COEP on ${files.length - missing.length}/${files.length} static scripts, wasm and pages${missing.length ? `; missing on ${missing.slice(0, 5).join(", ")}` : ""}`,
);

// 2. The server function, run from an isolated folder.
const dir = mkdtempSync(path.join(os.tmpdir(), "learn-pid-fn-"));
cpSync(fn, dir, { recursive: true });

try {
	const { default: handler } = await import(path.join(dir, "index.mjs"));
	for (const route of ["/", "/level/01-on-off", "/level/11-match"]) {
		const res = await handler.fetch(new Request(`https://learn-pid.example${route}`), { waitUntil() {} });
		const body = await res.text();
		const ok = res.status === 200 && res.headers.get("cross-origin-embedder-policy") === "require-corp";
		if (!ok) failed++;
		const title = body.match(/<title>([^<]*)/)?.[1] ?? body.slice(0, 120);
		console.log(`${ok ? "PASS" : "FAIL"} ${route} ${res.status} ${title}`);
	}
} finally {
	rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
