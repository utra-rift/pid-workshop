import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { type Connect, defineConfig, type Plugin } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

// clangd's WebAssembly build is multi-threaded and Pyodide's interrupt uses
// SharedArrayBuffer. Both need a cross-origin isolated page.
const ISOLATION = {
	"Cross-Origin-Opener-Policy": "same-origin",
	"Cross-Origin-Embedder-Policy": "require-corp",
};

const MIME: Record<string, string> = {
	".js": "text/javascript",
	".mjs": "text/javascript",
	".wasm": "application/wasm",
	".tar": "application/x-tar",
	".zip": "application/zip",
	".json": "application/json",
};

/**
 * Serves the big toolchain binaries (clang, clangd's wasm) from tools-dist/
 * at /tools in dev and preview. They are too large for the app's static
 * assets, so production loads them from VITE_TOOLS_URL (an R2 bucket).
 */
function serveTools(): Plugin {
	const dir = path.join(root, "tools-dist");
	const handler: Connect.NextHandleFunction = (req, res, next) => {
		const url = new URL(req.url ?? "/", "http://localhost");
		const file = path.join(dir, decodeURIComponent(url.pathname));
		if (
			!file.startsWith(dir) ||
			!existsSync(file) ||
			!statSync(file).isFile()
		) {
			next();
			return;
		}
		res.setHeader(
			"Content-Type",
			MIME[path.extname(file)] ?? "application/octet-stream",
		);
		res.setHeader("Content-Length", statSync(file).size);
		res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
		res.setHeader("Cache-Control", "no-cache");
		for (const [key, value] of Object.entries(ISOLATION))
			res.setHeader(key, value);
		createReadStream(file).pipe(res);
	};
	return {
		name: "serve-tools",
		configureServer(server) {
			server.middlewares.use("/tools", handler);
		},
		configurePreviewServer(server) {
			server.middlewares.use("/tools", handler);
		},
	};
}

export default defineConfig({
	resolve: {
		tsconfigPaths: true,
		alias: [
			// monaco-editor's exports map appends .js to every subpath, which breaks
			// its CSS imports. Point straight at the ESM tree instead.
			{
				find: /^monaco-esm\/(.*)$/,
				replacement: path.join(root, "node_modules/monaco-editor/esm/vs/$1"),
			},
			// These only export a "browser" condition. The server bundle still sees the
			// editor's dynamic imports (it never runs them), so point at the files.
			{
				find: /^vscode-languageserver-protocol\/browser$/,
				replacement: path.join(
					root,
					"node_modules/vscode-languageserver-protocol/lib/browser/main.js",
				),
			},
			{
				find: /^vscode-jsonrpc\/browser$/,
				replacement: path.join(
					root,
					"node_modules/vscode-jsonrpc/lib/browser/main.js",
				),
			},
		],
	},
	server: { headers: ISOLATION },
	preview: { headers: ISOLATION },
	worker: { format: "es" },
	plugins: [
		serveTools(),
		nitro({ routeRules: { "/**": { headers: ISOLATION } } }),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
	],
});
