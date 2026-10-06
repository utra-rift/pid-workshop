/// <reference types="vite/client" />

// monaco-esm/* is an alias to monaco-editor's ESM tree (see vite.config.ts).
declare module "monaco-esm/editor/editor.api.js" {
	export * from "monaco-editor";
}
declare module "monaco-esm/*";
