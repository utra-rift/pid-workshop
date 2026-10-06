import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, type Plugin } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

// clangd's WebAssembly build is multi-threaded and Pyodide's interrupt uses
// SharedArrayBuffer. Both need a cross-origin isolated page.
const ISOLATION = {
	"Cross-Origin-Opener-Policy": "same-origin",
	"Cross-Origin-Embedder-Policy": "require-corp",
};

/**
 * Monaco and the language servers only ever run in the browser, and only from
 * dynamic imports. Left in the server build, the bundler can put shared
 * helpers in their chunk, so every server render loads it and then fails on
 * vscode-jsonrpc, which isn't deployed with the server. On the server these
 * two entry points become stubs, and nothing behind them gets bundled.
 */
const CLIENT_ONLY: Record<string, string> = {
	[path.join(root, "src/editor/monaco.ts")]:
		"export function loadMonaco() { throw new Error('Monaco only runs in the browser.'); }",
	[path.join(root, "src/editor/lsp/servers.ts")]: [
		"export { FILE_URIS, ROOT_URI } from '#/editor/uris';",
		"export function getLanguageServer() { throw new Error('Language servers only run in the browser.'); }",
	].join("\n"),
};

function clientOnly(): Plugin {
	const PREFIX = "\0client-only:";
	return {
		name: "client-only-modules",
		enforce: "pre",
		async resolveId(source, importer, options) {
			if (this.environment?.config.consumer !== "server") return null;
			if (!source.includes("editor/monaco") && !source.includes("lsp/servers"))
				return null;
			const resolved = await this.resolve(source, importer, {
				...options,
				skipSelf: true,
			});
			return resolved && resolved.id in CLIENT_ONLY
				? PREFIX + resolved.id
				: null;
		},
		load(id) {
			return id.startsWith(PREFIX)
				? CLIENT_ONLY[id.slice(PREFIX.length)]
				: null;
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
	worker: {
		format: "es",
		// A new name pattern for worker files. Builds before the COEP fix served
		// them without the header, and browsers cache /assets for a year as
		// immutable, so a worker whose content didn't change kept its old URL and
		// its old, blocked response. If worker headers ever change again, change
		// this pattern too.
		rolldownOptions: {
			output: {
				entryFileNames: "assets/worker-[name]-[hash].js",
				chunkFileNames: "assets/worker-chunk-[name]-[hash].js",
			},
		},
	},
	plugins: [
		clientOnly(),
		nitro({
			routeRules: {
				"/**": { headers: ISOLATION },
				// Hosts like Vercel stop at the first matching route, and Nitro's own
				// cache rule for /assets comes first. Worker scripts live there, and
				// a worker without COEP won't start, so repeat the headers.
				"/assets/**": { headers: ISOLATION },
			},
		}),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
	],
});
