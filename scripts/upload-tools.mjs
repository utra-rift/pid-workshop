#!/usr/bin/env node
// Uploads vendor/ (see sync-tools.mjs) to the R2 bucket `cdn`, under learn-pid/.
// Production loads the toolchains from there, through cdn2.evanyu.dev.
//
// Every path includes its tool's version, so an object never changes once it's
// up. Each one is cached for a year as immutable, and a file that's already
// there with the same size and headers is skipped.
//
//   pnpm tools:upload            sync vendor/, then upload what's missing
//   pnpm tools:upload --cors     also set the bucket's CORS policy (scripts/r2-cors.json)
//
// Uses wrangler's login (`npx wrangler login`). In CI, set CLOUDFLARE_API_TOKEN
// to a token with R2 edit permission instead.

import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendor = path.join(root, "vendor");

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? "17b9ede6e77357f4ccea0f728476081d";
const BUCKET = "cdn";
const PREFIX = "learn-pid";
/** Must match src/tools.ts. */
const PUBLIC_URL = `https://cdn2.evanyu.dev/${PREFIX}`;
const CACHE = "public, max-age=31536000, immutable";
const TYPES = {
	".js": "text/javascript",
	".mjs": "text/javascript",
	".wasm": "application/wasm",
	".json": "application/json",
	".zip": "application/zip",
	".gz": "application/gzip",
};

const wrangler = (...args) =>
	execFileSync("npx", ["--yes", "wrangler@4.148.0", ...args], {
		cwd: root,
		env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT },
		stdio: ["ignore", "pipe", "inherit"],
		encoding: "utf8",
	});

if (process.argv.includes("--cors")) {
	wrangler("r2", "bucket", "cors", "set", BUCKET, "--file", "scripts/r2-cors.json", "--force");
	console.log(`CORS set on ${BUCKET}: any origin may GET and HEAD.`);
}

const files = readdirSync(vendor, { recursive: true })
	.map(String)
	.filter((file) => statSync(path.join(vendor, file)).isFile())
	.sort();

let uploaded = 0;
let bytes = 0;
for (const file of files) {
	const size = statSync(path.join(vendor, file)).size;
	const key = `${PREFIX}/${file.split(path.sep).join("/")}`;
	const type = TYPES[path.extname(file)] ?? "application/octet-stream";

	// Ask through the CDN with a query string, so this lookup gets its own cache
	// entry and can't leave a cached 404 on the real URL.
	const head = await fetch(`${PUBLIC_URL}/${file.split(path.sep).join("/")}?check=${Date.now()}`, {
		method: "HEAD",
		headers: { "accept-encoding": "identity" },
	});
	if (
		head.ok &&
		Number(head.headers.get("content-length")) === size &&
		head.headers.get("content-type") === type &&
		head.headers.get("cache-control") === CACHE
	) {
		console.log(`  same      ${key}`);
		continue;
	}

	wrangler(
		"r2",
		"object",
		"put",
		`${BUCKET}/${key}`,
		"--file",
		path.join("vendor", file),
		"--content-type",
		type,
		"--cache-control",
		CACHE,
		"--remote",
	);
	uploaded++;
	bytes += size;
	console.log(`  uploaded  ${key} (${(size / 1048576).toFixed(1)} MB)`);
}

console.log(`${uploaded} of ${files.length} files uploaded (${(bytes / 1048576).toFixed(1)} MB). Check them with: pnpm tools:check`);
