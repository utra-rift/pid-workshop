import { useSyncExternalStore } from "react";
import type { Lang } from "#/sim/types";

// Everything lives in localStorage: no accounts, no server.
const PREFIX = "pid:";

const listeners = new Set<() => void>();
function notify() {
	for (const listener of listeners) listener();
}

function read<T>(key: string, fallback: T): T {
	if (typeof localStorage === "undefined") return fallback;
	try {
		const raw = localStorage.getItem(PREFIX + key);
		return raw === null ? fallback : (JSON.parse(raw) as T);
	} catch {
		return fallback;
	}
}

function write(key: string, value: unknown) {
	if (typeof localStorage === "undefined") return;
	if (value === undefined) localStorage.removeItem(PREFIX + key);
	else localStorage.setItem(PREFIX + key, JSON.stringify(value));
	notify();
}

export interface LevelProgress {
	passedAt: string;
	lang: Lang;
}

export const storage = {
	getLang: (): Lang | null => read<Lang | null>("lang", null),
	setLang: (lang: Lang) => write("lang", lang),

	getProgress: (): Record<string, LevelProgress> => read("progress", {}),
	markPassed(levelId: string, lang: Lang, code: string) {
		const progress = storage.getProgress();
		progress[levelId] ??= { passedAt: new Date().toISOString(), lang };
		write("progress", progress);
		write(`passed:${levelId}:${lang}`, code);
	},
	getPassedCode: (levelId: string, lang: Lang): string | null =>
		read(`passed:${levelId}:${lang}`, null),

	getCode: (levelId: string, lang: Lang): string | null =>
		read(`code:${levelId}:${lang}`, null),
	setCode: (levelId: string, lang: Lang, code: string) => {
		if (typeof localStorage === "undefined") return;
		// No notify: the editor is the only reader, and it already has the text.
		localStorage.setItem(
			`${PREFIX}code:${levelId}:${lang}`,
			JSON.stringify(code),
		);
	},

	getHints: (levelId: string): number => read(`hints:${levelId}`, 0),
	setHints: (levelId: string, count: number) =>
		write(`hints:${levelId}`, count),

	isInstructor: (): boolean => read("instructor", false),
	setInstructor: (on: boolean) => write("instructor", on ? true : undefined),
};

function subscribe(listener: () => void) {
	listeners.add(listener);
	const onStorage = (event: StorageEvent) => {
		if (event.key?.startsWith(PREFIX)) listener();
	};
	window.addEventListener("storage", onStorage);
	return () => {
		listeners.delete(listener);
		window.removeEventListener("storage", onStorage);
	};
}

/** Re-renders when stored values change, including from other tabs. */
export function useStored<T>(get: () => T, serverValue: T): T {
	const cache = useSyncExternalStore(
		subscribe,
		() => JSON.stringify(get()),
		() => JSON.stringify(serverValue),
	);
	return JSON.parse(cache) as T;
}
