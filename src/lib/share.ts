import {
	compressToEncodedURIComponent,
	decompressFromEncodedURIComponent,
} from "lz-string";
import type { Lang } from "#/sim/types";

/** A link that opens the level with this code. The code stays in the hash, so it never reaches a server. */
export function shareUrl(levelId: string, lang: Lang, code: string): string {
	const url = new URL(`/level/${levelId}`, location.origin);
	url.searchParams.set("lang", lang);
	url.hash = `code=${compressToEncodedURIComponent(code)}`;
	return url.href;
}

export function readSharedCode(): string | null {
	const match = location.hash.match(/code=([^&]+)/);
	if (!match) return null;
	return decompressFromEncodedURIComponent(match[1]) || null;
}
