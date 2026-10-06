import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: { tsconfigPaths: true },
	test: {
		environment: "node",
		include: ["tests/**/*.test.ts"],
		// The level tests compile real C++ and boot real Pyodide.
		testTimeout: 180_000,
		hookTimeout: 180_000,
		pool: "forks",
	},
});
