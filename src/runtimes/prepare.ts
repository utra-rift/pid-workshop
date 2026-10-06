import { storage } from "#/lib/storage";
import type { Lang } from "#/sim/types";
import { TOOLS } from "#/tools";
import type { RuntimeStatus } from "./client";

export interface PrepareStatus {
	runtime: RuntimeStatus;
	server: RuntimeStatus;
	done: boolean;
	error?: string;
}

type Listener = (status: PrepareStatus) => void;

const IDLE: RuntimeStatus = { state: "idle", loaded: 0, total: 0, label: "" };

/** How long to wait for the language server once the runtime is ready. */
const SERVER_GRACE_MS = 30_000;

const entries = new Map<
	Lang,
	{ status: PrepareStatus; listeners: Set<Listener>; promise?: Promise<void> }
>();

function entry(lang: Lang) {
	let e = entries.get(lang);
	if (!e) {
		e = {
			status: { runtime: IDLE, server: IDLE, done: false },
			listeners: new Set(),
		};
		entries.set(lang, e);
	}
	return e;
}

function update(lang: Lang, patch: Partial<PrepareStatus>) {
	const e = entry(lang);
	e.status = { ...e.status, ...patch };
	for (const listener of e.listeners) listener(e.status);
}

/**
 * Downloads and starts everything a language needs before a lesson: its runtime
 * (Pyodide or clang) and its language server. Both live for the whole page, so
 * the lesson opens ready. A language server that won't start doesn't block:
 * the editor still works and Run still reports errors.
 */
export function prepareLanguage(lang: Lang): Promise<void> {
	const e = entry(lang);
	e.promise ??= (async () => {
		update(lang, { error: undefined });
		const { getRuntime } = await import("./client");
		const runtime = getRuntime(lang);
		runtime.subscribe((status) => update(lang, { runtime: status }));

		const server = (async () => {
			const [{ loadMonaco }, { getLanguageServer }] = await Promise.all([
				import("#/editor/monaco"),
				import("#/editor/lsp/servers"),
			]);
			const languageServer = getLanguageServer(lang, await loadMonaco());
			languageServer.subscribe((status) => update(lang, { server: status }));
			await languageServer.start();
			return true;
		})().catch(() => false);

		// The runtime is required. The language server gets a little longer, then
		// keeps loading inside the lesson, so a slow or stuck one can't block it.
		await runtime.ready();
		const serverStarted = await Promise.race([
			server,
			new Promise<false>((resolve) =>
				setTimeout(() => resolve(false), SERVER_GRACE_MS),
			),
		]);
		if (serverStarted) storage.markDownloaded(lang, downloadKey(lang));
		update(lang, { done: true });
	})().catch((error) => {
		e.promise = undefined;
		update(lang, { error: String((error as Error)?.message ?? error) });
		throw error;
	});
	return e.promise;
}

/** Calls back with the language's download status now and on every change. */
export function watchPrepare(lang: Lang, listener: Listener): () => void {
	const e = entry(lang);
	e.listeners.add(listener);
	listener(e.status);
	return () => e.listeners.delete(listener);
}

/** 0 to 1 across both downloads, or null while the sizes aren't known yet. */
export function prepareProgress(status: PrepareStatus): number | null {
	const parts = [status.runtime, status.server];
	let loaded = 0;
	let total = 0;
	for (const part of parts) {
		if (part.state === "ready" || part.state === "failed") {
			loaded += part.total || 1;
			total += part.total || 1;
		} else {
			loaded += part.loaded;
			total += part.total;
		}
	}
	return total > 0 ? Math.min(1, loaded / total) : null;
}

/** Names a language's tool versions and where they come from. */
export function downloadKey(lang: Lang): string {
	return lang === "python"
		? `${TOOLS.url} pyodide ${TOOLS.pyodide.version} basedpyright ${TOOLS.basedpyright.version}`
		: `${TOOLS.url} clang ${TOOLS.clang.version} clangd ${TOOLS.clangd.version}`;
}

/**
 * Whether starting this language would skip the download: it's running on
 * this page, or this browser downloaded these versions before and should
 * still have them cached.
 */
export function isDownloaded(
	lang: Lang,
	downloaded = storage.getDownloaded(),
): boolean {
	return entry(lang).status.done || downloaded[lang] === downloadKey(lang);
}
