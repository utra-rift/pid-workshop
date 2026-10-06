// Where the in-browser toolchains live. Versions must match scripts/sync-tools.mjs.

/** The big binaries. /tools in dev (served from tools-dist/), an R2 bucket in production. */
const TOOLS_URL = (import.meta.env.VITE_TOOLS_URL ?? "/tools").replace(
	/\/$/,
	"",
);
/** Small files that must be same-origin, shipped in public/vendor. */
const VENDOR_URL = "/vendor";

const absolute = (url: string) =>
	typeof location === "undefined" ? url : new URL(url, location.origin).href;

export const TOOLS = {
	pyodide: {
		version: "314.0.7",
		get base() {
			return absolute(`${VENDOR_URL}/pyodide/314.0.7`);
		},
		/** Fetched up front so the progress bar has something to measure. */
		files: ["pyodide.asm.wasm", "python_stdlib.zip", "pyodide.asm.mjs"],
	},
	basedpyright: {
		version: "1.40.2",
		get worker() {
			return absolute(`${VENDOR_URL}/basedpyright/1.40.2/pyright.worker.js`);
		},
	},
	clang: {
		version: "22.0.0-git20542-10",
		get bundle() {
			return absolute(`${TOOLS_URL}/clang/22.0.0-git20542-10/bundle.js`);
		},
	},
	clangd: {
		version: "21.1.0",
		get js() {
			return absolute(`${VENDOR_URL}/clangd/21.1.0/clangd.js`);
		},
		get wasm() {
			return absolute(`${TOOLS_URL}/clangd/21.1.0/clangd.wasm`);
		},
	},
} as const;
