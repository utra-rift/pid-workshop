import {
	BrowserMessageReader,
	BrowserMessageWriter,
} from "vscode-languageserver-protocol/browser";
import type { RuntimeStatus } from "#/runtimes/client";
import { ROBOT_PYI } from "#/runtimes/python/files";
import { fetchBytes, type WorkerEvent } from "#/runtimes/rpc";
import type { Lang } from "#/sim/types";
import { TOOLS } from "#/tools";
import type { MonacoApi } from "../monaco";
import { ROOT_URI } from "../uris";
import { LspClient } from "./client";

export { FILE_URIS, ROOT_URI } from "../uris";

type Listener = (status: RuntimeStatus) => void;

/** A language server for one language, started on first use. */
export class LanguageServer {
	status: RuntimeStatus = { state: "idle", loaded: 0, total: 0, label: "" };
	private listeners = new Set<Listener>();
	private starting?: Promise<LspClient>;

	constructor(
		readonly lang: Lang,
		private readonly monaco: MonacoApi,
	) {}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		listener(this.status);
		return () => this.listeners.delete(listener);
	}

	private setStatus(patch: Partial<RuntimeStatus>) {
		this.status = { ...this.status, ...patch };
		for (const listener of this.listeners) listener(this.status);
	}

	start(): Promise<LspClient> {
		this.starting ??= (
			this.lang === "python" ? this.startPython() : this.startCpp()
		).catch((error) => {
			this.setStatus({
				state: "failed",
				error: String((error as Error)?.message ?? error),
			});
			throw error;
		});
		return this.starting;
	}

	private async startPython(): Promise<LspClient> {
		this.setStatus({ state: "loading", label: "Python language server" });
		// Download the 18 MB worker ourselves for a progress bar, then run it
		// from memory. Its background workers reuse the same blob URL.
		const bytes = await fetchBytes(
			TOOLS.basedpyright.worker,
			"Python language server",
			(loaded, total, label) =>
				this.setStatus({ state: "loading", loaded, total, label }),
		);
		const url = URL.createObjectURL(
			new Blob([bytes as BlobPart], { type: "text/javascript" }),
		);
		const worker = new Worker(url, { name: "basedpyright", type: "classic" });
		worker.postMessage({ type: "browser/boot", mode: "foreground" });
		// basedpyright asks for helper workers to do background analysis.
		worker.addEventListener("message", (event: MessageEvent) => {
			if (event.data?.type !== "browser/newWorker") return;
			const { initialData, port } = event.data;
			const background = new Worker(url, {
				name: "basedpyright-background",
				type: "classic",
			});
			background.postMessage(
				{ type: "browser/boot", mode: "background", initialData, port },
				[port],
			);
		});

		const client = new LspClient({
			name: "basedpyright",
			languageId: "python",
			monaco: this.monaco,
			reader: new BrowserMessageReader(worker),
			writer: new BrowserMessageWriter(worker),
			rootUri: ROOT_URI,
			initializationOptions: {
				files: {
					"/workspace/robot.pyi": ROBOT_PYI,
					// Beginner code has no type annotations; strict mode would flag every line.
					"/workspace/pyrightconfig.json": JSON.stringify({
						typeCheckingMode: "basic",
						reportMissingModuleSource: false,
					}),
				},
			},
			// Auto-import suggestions fill the list with the whole standard library,
			// and a beginner pressing Enter accepts one by accident.
			configuration: (section) =>
				section === "python" || section === "basedpyright"
					? {
							analysis: {
								autoImportCompletions: false,
								typeCheckingMode: "basic",
							},
						}
					: {},
		});
		await client.start();
		this.setStatus({ state: "ready" });
		return client;
	}

	private async startCpp(): Promise<LspClient> {
		this.setStatus({ state: "loading", label: "C++ language server" });
		const worker = new Worker(new URL("./clangd.worker.ts", import.meta.url), {
			type: "module",
			name: "clangd",
		});
		const ready = new Promise<void>((resolve, reject) => {
			worker.addEventListener("message", (event: MessageEvent<WorkerEvent>) => {
				const data = event.data;
				if (data?.type === "progress") {
					this.setStatus({
						state: "loading",
						loaded: data.loaded,
						total: data.total,
						label: data.label,
					});
				} else if (data?.type === "ready") resolve();
				else if (data?.type === "failed") reject(new Error(data.message));
			});
			worker.addEventListener("error", (event) =>
				reject(new Error(event.message || "clangd failed to load.")),
			);
		});
		const channel = new MessageChannel();
		worker.postMessage({ type: "init", port: channel.port2 }, [channel.port2]);
		await ready;

		const client = new LspClient({
			name: "clangd",
			languageId: "cpp",
			monaco: this.monaco,
			reader: new BrowserMessageReader(channel.port1),
			writer: new BrowserMessageWriter(channel.port1),
			rootUri: ROOT_URI,
		});
		await client.start();
		this.setStatus({ state: "ready" });
		return client;
	}
}

const servers: Partial<Record<Lang, LanguageServer>> = {};

export function getLanguageServer(
	lang: Lang,
	monaco: MonacoApi,
): LanguageServer {
	servers[lang] ??= new LanguageServer(lang, monaco);
	return servers[lang] as LanguageServer;
}
