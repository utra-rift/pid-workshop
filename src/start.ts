import { createMiddleware, createStart } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";

// Every page has to be cross-origin isolated so clangd and Pyodide can use
// SharedArrayBuffer. Static files get the same headers from the host config
// (nitro routeRules in vite.config.ts).
const crossOriginIsolation = createMiddleware().server(({ next }) => {
	setResponseHeader("Cross-Origin-Opener-Policy", "same-origin");
	setResponseHeader("Cross-Origin-Embedder-Policy", "require-corp");
	return next();
});

export const startInstance = createStart(() => ({
	requestMiddleware: [crossOriginIsolation],
}));
