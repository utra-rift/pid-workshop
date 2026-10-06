/// <reference lib="webworker" />
import { TOOLS } from "#/tools";
import { emit, inflate, serve } from "../rpc";
import { type ClangCommands, compileCpp } from "./harness";

let booting: Promise<ClangCommands> | undefined;

/**
 * clang's two big files ship gzipped (see scripts/sync-tools.mjs). @yowasp/clang
 * captures globalThis.fetch when its bundle loads, so swap in a fetch that asks
 * for the .gz and hands back the inflated stream. Install before the import.
 */
function fetchGzipped() {
	const realFetch = globalThis.fetch.bind(globalThis);
	const gzipped = new Set(
		TOOLS.clang.gzipped.map((file) => `${TOOLS.clang.base}/${file}`),
	);
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = input instanceof Request ? input.url : String(input);
		if (!gzipped.has(url)) return realFetch(input, init);
		const response = await realFetch(`${url}.gz`, init);
		if (!response.ok || !response.body) return response;
		return new Response(await inflate(response.body), {
			headers: {
				"Content-Type": url.endsWith(".wasm")
					? "application/wasm"
					: "application/octet-stream",
			},
		});
	}) as typeof fetch;
}

async function boot(): Promise<ClangCommands> {
	fetchGzipped();
	const { commands } = (await import(
		/* @vite-ignore */ TOOLS.clang.bundle
	)) as { commands: ClangCommands };
	// The first command downloads and compiles about 100 MB of WebAssembly.
	// Do it now, with a progress bar, instead of on the student's first Run.
	await commands["clang++"](
		["--version"],
		{},
		{
			stdout: null,
			stderr: null,
			fetchProgress: ({ totalLength, doneLength }) =>
				emit({
					type: "progress",
					loaded: doneLength,
					total: totalLength,
					label: "C++ compiler",
				}),
		},
	);
	emit({ type: "ready" });
	return commands;
}

serve({
	init() {
		booting ??= boot();
		return booting.then(() => true);
	},
	async check(source: string) {
		booting ??= boot();
		return compileCpp(await booting, source, "check");
	},
	async build(params: { source: string; entries: string[]; reading: string }) {
		booting ??= boot();
		const result = await compileCpp(
			await booting,
			params.source,
			"build",
			params.entries,
			params.reading,
		);
		return result.wasm ? { ...result, transfer: [result.wasm.buffer] } : result;
	},
});
