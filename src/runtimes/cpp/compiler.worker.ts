/// <reference lib="webworker" />
import { TOOLS } from "#/tools";
import { emit, serve } from "../rpc";
import { type ClangCommands, compileCpp } from "./harness";

let booting: Promise<ClangCommands> | undefined;

async function boot(): Promise<ClangCommands> {
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
	async build(params: { source: string; entries: string[] }) {
		booting ??= boot();
		const result = await compileCpp(
			await booting,
			params.source,
			"build",
			params.entries,
		);
		return result.wasm ? { ...result, transfer: [result.wasm.buffer] } : result;
	},
});
