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

// Per-level values are keyed by level number.
export const storage = {
	getLang: (): Lang | null => read<Lang | null>("lang", null),
	setLang: (lang: Lang) => write("lang", lang),

	/** Passed levels, by level number. */
	getProgress: (): Record<number, LevelProgress> => read("progress", {}),
	markPassed(level: number, lang: Lang, code: string) {
		const progress = storage.getProgress();
		progress[level] ??= { passedAt: new Date().toISOString(), lang };
		write("progress", progress);
		write(`passed:${level}:${lang}`, code);
	},
	getPassedCode: (level: number, lang: Lang): string | null =>
		read(`passed:${level}:${lang}`, null),

	getCode: (level: number, lang: Lang): string | null =>
		read(`code:${level}:${lang}`, null),
	setCode: (level: number, lang: Lang, code: string) => {
		if (typeof localStorage === "undefined") return;
		// No notify: the editor is the only reader, and it already has the text.
		localStorage.setItem(
			`${PREFIX}code:${level}:${lang}`,
			JSON.stringify(code),
		);
	},

	getHints: (level: number): number => read(`hints:${level}`, 0),
	setHints: (level: number, count: number) => write(`hints:${level}`, count),

	isInstructor: (): boolean => read("instructor", false),
	setInstructor: (on: boolean) => write("instructor", on ? true : undefined),

	/**
	 * Toolchains this browser has downloaded, by language. Each value names the
	 * versions and where they came from, so a new version counts as new.
	 */
	getDownloaded: (): Partial<Record<Lang, string>> => read("downloaded", {}),
	markDownloaded(lang: Lang, key: string) {
		const downloaded = storage.getDownloaded();
		if (downloaded[lang] === key) return;
		downloaded[lang] = key;
		write("downloaded", downloaded);
	},

	/** The dev tools button, toggled with the Konami code. */
	isDev: (): boolean => read("dev", false),
	setDev: (on: boolean) => write("dev", on ? true : undefined),

	/** Marks these levels passed, without any passing code. For testing. */
	passAll(levels: number[]) {
		const progress = storage.getProgress();
		const lang = storage.getLang() ?? "python";
		const passedAt = new Date().toISOString();
		for (const level of levels) progress[level] ??= { passedAt, lang };
		write("progress", progress);
	},

	/** Clears passed levels, saved code and hints. Settings stay. */
	resetProgress() {
		if (typeof localStorage === "undefined") return;
		for (const key of Object.keys(localStorage)) {
			if (/^pid:(progress$|code:|passed:|hints:)/.test(key))
				localStorage.removeItem(key);
		}
		notify();
	},
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
