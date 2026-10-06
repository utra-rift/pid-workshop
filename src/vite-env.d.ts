/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** Base URL for the big toolchain binaries. Defaults to /tools. */
	readonly VITE_TOOLS_URL?: string;
}

// monaco-esm/* is an alias to monaco-editor's ESM tree (see vite.config.ts).
declare module "monaco-esm/editor/editor.api.js" {
	export * from "monaco-editor";
}
declare module "monaco-esm/*";
