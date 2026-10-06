/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** Where the toolchains are served from. See src/tools.ts. */
	readonly VITE_TOOLS_URL?: string;
}

// monaco-esm/* is an alias to monaco-editor's ESM tree (see vite.config.ts).
declare module "monaco-esm/editor/editor.api.js" {
	export * from "monaco-editor";
}
declare module "monaco-esm/*";
