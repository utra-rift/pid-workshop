// Where the in-browser toolchains live: public/vendor, shipped with the app.
// Versions must match scripts/sync-tools.mjs.

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
		get base() {
			return absolute(`${VENDOR_URL}/clang/22.0.0-git20542-10`);
		},
		get bundle() {
			return `${this.base}/bundle.js`;
		},
		/** Shipped as `<name>.gz`; the compiler worker inflates them as they load. */
		gzipped: ["llvm.core.wasm", "llvm-resources.tar"],
	},
	clangd: {
		version: "21.1.0",
		get js() {
			return absolute(`${VENDOR_URL}/clangd/21.1.0/clangd.js`);
		},
		/** Gzipped; the clangd worker inflates it. */
		get wasmGz() {
			return absolute(`${VENDOR_URL}/clangd/21.1.0/clangd.wasm.gz`);
		},
	},
} as const;
