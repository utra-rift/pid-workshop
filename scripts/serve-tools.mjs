#!/usr/bin/env node
// Serves tools-dist/ from its own origin, with CORS, the way the R2 bucket will.
// Use it to try a production build locally:
//
//   node scripts/serve-tools.mjs 3003 &
//   VITE_TOOLS_URL=http://localhost:3003 pnpm build
//   PORT=3002 node .output/server/index.mjs

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.argv[2] ?? 3003);
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tools-dist");
const MIME = { ".js": "text/javascript", ".wasm": "application/wasm", ".tar": "application/x-tar" };

createServer((req, res) => {
	const url = new URL(req.url ?? "/", "http://localhost");
	const file = path.join(dir, decodeURIComponent(url.pathname));
	res.setHeader("Access-Control-Allow-Origin", "*");
	if (req.method === "OPTIONS") {
		res.writeHead(204, { "Access-Control-Allow-Methods": "GET, HEAD" }).end();
		return;
	}
	if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) {
		res.writeHead(404).end();
		return;
	}
	res.writeHead(200, {
		"Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
		"Content-Length": statSync(file).size,
		"Cache-Control": "public, max-age=31536000, immutable",
	});
	createReadStream(file).pipe(res);
}).listen(port, () => console.log(`tools on http://localhost:${port}`));
