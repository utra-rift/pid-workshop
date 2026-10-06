/// <reference lib="webworker" />
import type { PyodideAPI } from "pyodide";
import { TOOLS } from "#/tools";
import { emit, prefetch, serve } from "../rpc";
import type { RunRequest } from "../types";
import { createPythonHarness, type PythonHarness } from "./harness";

let interrupt: Int32Array | undefined;
let booting: Promise<PythonHarness> | undefined;

async function boot(): Promise<PythonHarness> {
	const base = TOOLS.pyodide.base;
	await prefetch(
		TOOLS.pyodide.files.map((file) => `${base}/${file}`),
		"Python",
		(loaded, total, label) => emit({ type: "progress", loaded, total, label }),
	);
	const { loadPyodide } = (await import(
		/* @vite-ignore */ `${base}/pyodide.mjs`
	)) as {
		loadPyodide: (options: { indexURL: string }) => Promise<PyodideAPI>;
	};
	const py = await loadPyodide({ indexURL: `${base}/` });
	if (interrupt) py.setInterruptBuffer(interrupt);
	const harness = createPythonHarness(py);
	emit({ type: "ready" });
	return harness;
}

serve({
	init(params: { interrupt?: Int32Array }) {
		interrupt = params?.interrupt;
		booting ??= boot();
		return booting.then(() => true);
	},
	async check(source: string) {
		booting ??= boot();
		return (await booting).check(source);
	},
	async run(request: RunRequest) {
		booting ??= boot();
		const harness = await booting;
		if (interrupt) Atomics.store(interrupt, 0, 0);
		return harness.run(request);
	},
});
