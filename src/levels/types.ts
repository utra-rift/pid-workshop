import type { Metrics } from "#/sim/metrics";
import type { Lang, RunResult, SimSpec, Variant } from "#/sim/types";

/** Text that differs by language. Plain strings apply to both. */
export type Localized = string | Record<Lang, string>;

export interface WrongAnswer {
	name: string;
	code: Partial<Record<Lang, string>>;
	/** The coach message this answer must produce. */
	expect: RegExp;
}

export interface Level {
	id: string;
	number: number;
	title: string;
	/** One or two sentences: what's going on. Inline `code` and **bold** allowed. */
	story: string;
	goal: string;
	hints: [Localized, Localized];
	/** The takeaway, shown when the level passes. */
	why: string;
	stretch?: boolean;
	spec: SimSpec;
	/** The first variant is the one students watch. The rest are hidden tests. */
	variants: Variant[];
	starter: Record<Lang, string>;
	solution: Record<Lang, string>;
	wrongAnswers: WrongAnswer[];
	pass(m: Metrics): boolean;
	/** Level-specific advice for a failed run. Checked before the general advice. */
	coach?(m: Metrics, run: RunResult): string | null;
}

export function localize(text: Localized, lang: Lang): string {
	return typeof text === "string" ? text : text[lang];
}

/** Strips the common leading indentation so code can be written indented in source. */
export function code(
	strings: TemplateStringsArray,
	...values: unknown[]
): string {
	const raw = String.raw({ raw: strings }, ...values)
		.replace(/^\n/, "")
		.replace(/\n\s*$/, "\n");
	const lines = raw.split("\n");
	const indent = Math.min(
		...lines
			.filter((line) => line.trim())
			.map((line) => line.match(/^\s*/)?.[0].length ?? 0),
	);
	return lines.map((line) => line.slice(indent)).join("\n");
}
