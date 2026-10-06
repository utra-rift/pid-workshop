#!/usr/bin/env node
// Runs the built Vercel function the way Vercel does: from a folder with no
// project node_modules above it, so a package the bundle forgot to include
// fails here instead of in production.
//
//   NITRO_PRESET=vercel pnpm build && node scripts/check-vercel.mjs

import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const fn = path.join(root, ".vercel/output/functions/__server.func");
if (!existsSync(fn)) {
	console.error("No Vercel build found. Run: NITRO_PRESET=vercel pnpm build");
	process.exit(1);
}

const dir = mkdtempSync(path.join(os.tmpdir(), "learn-pid-fn-"));
cpSync(fn, dir, { recursive: true });

let failed = 0;
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
