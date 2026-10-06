import type { RunIssue, RunResult, SimSpec, Variant } from "#/sim/types";

/** A compiler or syntax error, positioned in the student's file. 1-based. */
export interface Diagnostic {
	line: number;
	column: number;
	endLine?: number;
	endColumn?: number;
	severity: "error" | "warning" | "info";
	message: string;
}

/** The result of checking or building code without running it. */
export interface BuildResult {
	ok: boolean;
	diagnostics: Diagnostic[];
	/** Raw compiler output, for the console. */
	output: string;
	/** Set when the code can't run at all, such as a missing `controller`. */
	issue?: RunIssue;
}

export interface RunRequest {
	source: string;
	spec: SimSpec;
	variants: Variant[];
	/** The function to call each tick. */
	entry: string;
}

export interface RunResponse {
	build: BuildResult;
	results: RunResult[];
}

export type ProgressFn = (loaded: number, total: number, label: string) => void;
