import type { ProgressFn } from "./types";

/** Messages a worker sends that aren't replies. */
export type WorkerEvent =
	| { type: "progress"; loaded: number; total: number; label: string }
	| { type: "ready" }
	| { type: "failed"; message: string };

interface Reply {
	id: number;
	result?: unknown;
	error?: string;
}

/** Worker side: answers `{ id, method, params }` with `{ id, result | error }`. */
export function serve(handlers: Record<string, (params: never) => unknown>) {
	const scope = self as unknown as DedicatedWorkerGlobalScope;
	scope.addEventListener("message", async (event: MessageEvent) => {
		const { id, method, params } = event.data ?? {};
		if (typeof id !== "number" || !(method in handlers)) return;
		try {
			const result = await handlers[method](params as never);
			const transfer =
				result && typeof result === "object" && "transfer" in result
					? (result as { transfer: Transferable[] }).transfer
					: [];
			scope.postMessage({ id, result } satisfies Reply, transfer);
		} catch (error) {
			scope.postMessage({
				id,
				error: String((error as Error)?.message ?? error),
			} satisfies Reply);
		}
	});
}

export function emit(event: WorkerEvent) {
	(self as unknown as DedicatedWorkerGlobalScope).postMessage(event);
}

/** Main-thread side of a worker that can be restarted when it hangs. */
export class WorkerRpc {
	private worker: Worker;
	private nextId = 1;
	private pending = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void }
	>();

	constructor(
		private readonly create: () => Worker,
		private readonly onEvent: (event: WorkerEvent) => void = () => {},
	) {
		this.worker = this.spawn();
	}

	private spawn(): Worker {
		const worker = this.create();
		worker.addEventListener("message", (event: MessageEvent) => {
			const data = event.data;
			if (data && typeof data.id === "number" && this.pending.has(data.id)) {
				const entry = this.pending.get(data.id);
				this.pending.delete(data.id);
				if ("error" in data && data.error !== undefined)
					entry?.reject(new Error(data.error));
				else entry?.resolve(data.result);
				return;
			}
			if (data?.type) this.onEvent(data as WorkerEvent);
		});
		worker.addEventListener("error", (event) => {
			const error = new Error(event.message || "The worker crashed.");
			for (const entry of this.pending.values()) entry.reject(error);
			this.pending.clear();
			this.onEvent({ type: "failed", message: error.message });
		});
		return worker;
	}

	call<T>(
		method: string,
		params?: unknown,
		transfer: Transferable[] = [],
	): Promise<T> {
		const id = this.nextId++;
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, {
				resolve: resolve as (value: unknown) => void,
				reject,
			});
			this.worker.postMessage({ id, method, params }, transfer);
		});
	}

	/** Kills the worker (say, stuck in an infinite loop) and starts a fresh one. */
	restart() {
		this.worker.terminate();
		const error = new Error("restarted");
		for (const entry of this.pending.values()) entry.reject(error);
		this.pending.clear();
		this.worker = this.spawn();
	}

	terminate() {
		this.worker.terminate();
	}
}

/** Fetches files and reports combined progress. The browser cache keeps them for the real load. */
export async function prefetch(
	urls: string[],
	label: string,
	onProgress: ProgressFn,
): Promise<void> {
	const responses = await Promise.all(urls.map((url) => fetch(url)));
	for (const response of responses) {
		if (!response.ok)
			throw new Error(`${response.url}: HTTP ${response.status}`);
	}
	const total = responses.reduce(
		(sum, r) => sum + Number(r.headers.get("content-length") ?? 0),
		0,
	);
	let loaded = 0;
	await Promise.all(
		responses.map(async (response) => {
			const reader = response.body?.getReader();
			if (!reader) return;
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				loaded += value.byteLength;
				onProgress(loaded, Math.max(total, loaded), label);
			}
		}),
	);
}

/** Fetches one file into memory, reporting progress. */
export async function fetchBytes(
	url: string,
	label: string,
	onProgress: ProgressFn,
): Promise<Uint8Array> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	const total = Number(response.headers.get("content-length") ?? 0);
	const reader = response.body?.getReader();
	if (!reader) return new Uint8Array(await response.arrayBuffer());
	const chunks: Uint8Array[] = [];
	let loaded = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		loaded += value.byteLength;
		onProgress(loaded, Math.max(total, loaded), label);
	}
	const bytes = new Uint8Array(loaded);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}
