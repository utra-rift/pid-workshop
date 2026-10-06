import type { Lang, RunIssue, RunResult } from "#/sim/types";
import { type WorkerEvent, WorkerRpc } from "./rpc";
import type { BuildResult, RunRequest, RunResponse } from "./types";

export interface RuntimeStatus {
	state: "idle" | "loading" | "ready" | "failed";
	loaded: number;
	total: number;
	label: string;
	error?: string;
}

type Listener = (status: RuntimeStatus) => void;

/** Real time the student's code gets per run, across all variants. */
const RUN_BUDGET_MS = 4000;

abstract class Runtime {
	abstract readonly lang: Lang;
	status: RuntimeStatus = { state: "idle", loaded: 0, total: 0, label: "" };
	private listeners = new Set<Listener>();
	private starting?: Promise<void>;

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		listener(this.status);
		return () => this.listeners.delete(listener);
	}

	protected setStatus(patch: Partial<RuntimeStatus>) {
		this.status = { ...this.status, ...patch };
		for (const listener of this.listeners) listener(this.status);
	}

	protected handleEvent = (event: WorkerEvent) => {
		if (event.type === "progress") {
			this.setStatus({
				state: "loading",
				loaded: event.loaded,
				total: event.total,
				label: event.label,
			});
		} else if (event.type === "failed") {
			this.setStatus({ state: "failed", error: event.message });
		}
	};

	/** Downloads and boots the toolchain. Safe to call more than once. */
	ready(): Promise<void> {
		this.starting ??= (async () => {
			this.setStatus({ state: "loading" });
			try {
				await this.boot();
				this.setStatus({ state: "ready" });
			} catch (error) {
				this.setStatus({
					state: "failed",
					error: String((error as Error)?.message ?? error),
				});
				this.starting = undefined;
				throw error;
			}
		})();
		return this.starting;
	}

	protected abstract boot(): Promise<void>;
	abstract check(source: string): Promise<BuildResult>;
	abstract run(request: RunRequest): Promise<RunResponse>;
}

function timedOut(request: RunRequest): RunResult[] {
	const issue: RunIssue = {
		kind: "timeout",
		message:
			"Your code took too long to finish. Look for a loop that never ends.",
	};
	return request.variants.map((variant) => ({
		variant,
		samples: [],
		plots: {},
		logs: [],
		events: [],
		browned: false,
		issue,
	}));
}

class PythonRuntime extends Runtime {
	readonly lang = "python" as const;
	// Lets the page raise KeyboardInterrupt inside a runaway loop. Needs cross-origin isolation.
	private interrupt =
		typeof SharedArrayBuffer !== "undefined" && globalThis.crossOriginIsolated
			? new Int32Array(new SharedArrayBuffer(4))
			: undefined;
	private rpc = new WorkerRpc(
		() =>
			new Worker(new URL("./python/python.worker.ts", import.meta.url), {
				type: "module",
				name: "python",
			}),
		this.handleEvent,
	);

	protected async boot() {
		await this.rpc.call("init", { interrupt: this.interrupt });
	}

	async check(source: string) {
		await this.ready();
		return this.rpc.call<BuildResult>("check", source);
	}

	async run(request: RunRequest): Promise<RunResponse> {
		await this.ready();
		const interrupt = this.interrupt;
		let soft: ReturnType<typeof setTimeout> | undefined;
		let hard: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<RunResponse>((resolve) => {
			// First ask Python to stop; if it's stuck outside Python, kill the worker.
			soft = setTimeout(
				() => interrupt && Atomics.store(interrupt, 0, 2),
				RUN_BUDGET_MS,
			);
			hard = setTimeout(() => {
				// Settle first: restarting rejects the pending call.
				resolve({
					build: { ok: true, diagnostics: [], output: "" },
					results: timedOut(request),
				});
				this.rpc.restart();
				this.setStatus({ state: "loading" });
				void this.rpc
					.call("init", { interrupt })
					.then(() => this.setStatus({ state: "ready" }));
			}, RUN_BUDGET_MS + 3000);
		});
		try {
			return await Promise.race([
				this.rpc.call<RunResponse>("run", request),
				timeout,
			]);
		} finally {
			clearTimeout(soft);
			clearTimeout(hard);
		}
	}
}

class CppRuntime extends Runtime {
	readonly lang = "cpp" as const;
	private compiler = new WorkerRpc(
		() =>
			new Worker(new URL("./cpp/compiler.worker.ts", import.meta.url), {
				type: "module",
				name: "clang",
			}),
		this.handleEvent,
	);
	private runner = new WorkerRpc(
		() =>
			new Worker(new URL("./cpp/runner.worker.ts", import.meta.url), {
				type: "module",
				name: "cpp-runner",
			}),
	);

	protected async boot() {
		await this.compiler.call("init");
	}

	async check(source: string) {
		await this.ready();
		return this.compiler.call<BuildResult>("check", source);
	}

	async run(request: RunRequest): Promise<RunResponse> {
		await this.ready();
		const build = await this.compiler.call<BuildResult & { wasm?: Uint8Array }>(
			"build",
			{
				source: request.source,
				entries: [request.entry],
			},
		);
		const { wasm, ...buildResult } = build;
		if (!build.ok || !wasm) return { build: buildResult, results: [] };

		const { source: _source, ...rest } = request;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<RunResult[]>((resolve) => {
			timer = setTimeout(() => {
				// Settle first: restarting rejects the pending call.
				resolve(timedOut(request));
				this.runner.restart();
			}, RUN_BUDGET_MS);
		});
		try {
			const results = await Promise.race([
				this.runner.call<RunResult[]>("run", { wasm, request: rest }, [
					wasm.buffer,
				]),
				timeout,
			]);
			return { build: buildResult, results };
		} finally {
			clearTimeout(timer);
		}
	}
}

const runtimes: Partial<Record<Lang, Runtime>> = {};

/** One runtime per language for the whole page. */
export function getRuntime(lang: Lang): Runtime {
	runtimes[lang] ??= lang === "python" ? new PythonRuntime() : new CppRuntime();
	return runtimes[lang] as Runtime;
}

export type { Runtime };
