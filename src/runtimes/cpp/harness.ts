import { ConsoleStdout, File, OpenFile, WASI } from "@bjorn3/browser_wasi_shim";
import { MECHANISMS } from "#/sim/robot";
import { Recorder, simulate } from "#/sim/simulate";
import { ControllerError, type RunIssue, type RunResult } from "#/sim/types";
import type {
	BuildResult,
	Diagnostic,
	RunRequest,
	RunResponse,
} from "../types";
import { CPP_FLAGS, FILE, PRELUDE_H, ROBOT_H } from "./files";

export { CPP_FLAGS, FILE, PRELUDE_H, ROBOT_H };

/** The subset of @yowasp/clang's API we use. */
export interface ClangCommands {
	"clang++": (
		args: string[],
		files: Record<string, string | Uint8Array>,
		options?: {
			stdout?: ((bytes: Uint8Array | null) => void) | null;
			stderr?: ((bytes: Uint8Array | null) => void) | null;
			decodeASCII?: boolean;
			fetchProgress?: (event: {
				totalLength: number;
				doneLength: number;
			}) => void;
		},
	) => Promise<Record<string, unknown>> | Record<string, unknown> | undefined;
}

export interface CppBuild extends BuildResult {
	wasm?: Uint8Array;
}

/**
 * Compiles the student's file. mode "check" only parses it, which is what the
 * editor runs while you type; "build" links a WebAssembly module. `reading`
 * names the controller's first parameter in error messages.
 */
export async function compileCpp(
	clang: ClangCommands,
	source: string,
	mode: "build" | "check",
	entries: string[] = ["controller"],
	reading = "angle",
): Promise<CppBuild> {
	let output = "";
	const decoder = new TextDecoder();
	const collect = (bytes: Uint8Array | null) => {
		if (bytes) output += decoder.decode(bytes, { stream: true });
	};
	const args =
		mode === "check"
			? [...CPP_FLAGS, "-fsyntax-only", FILE]
			: [
					...CPP_FLAGS,
					"-O2",
					"-mexec-model=reactor",
					FILE,
					"-o",
					"controller.wasm",
					...entries.map((entry) => `-Wl,--export=${entry}`),
				];
	const files = { [FILE]: source, "robot.h": ROBOT_H, "prelude.h": PRELUDE_H };

	let out: Record<string, unknown> | undefined;
	let failed = false;
	try {
		out =
			(await clang["clang++"](args, files, {
				stdout: collect,
				stderr: collect,
			})) ?? undefined;
	} catch {
		// @yowasp/clang throws on a non-zero exit; the reason is in `output`.
		failed = true;
	}

	const diagnostics = parseClangOutput(output);
	const wasm = out?.["controller.wasm"];
	const ok = !failed && !diagnostics.some((d) => d.severity === "error");
	const result: CppBuild = { ok, diagnostics, output: output.trim() };
	if (ok && mode === "build" && wasm instanceof Uint8Array) result.wasm = wasm;
	if (!ok) result.issue = buildIssue(output, diagnostics, entries, reading);
	return result;
}

const DIAGNOSTIC =
	/^(controller\.cpp|robot\.h):(\d+):(\d+): (fatal error|error|warning|note): (.*)$/;

export function parseClangOutput(output: string): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	for (const line of output.split("\n")) {
		const m = line.match(DIAGNOSTIC);
		if (!m) continue;
		const [, file, lineNo, column, level, message] = m;
		if (level === "note") {
			const previous = diagnostics.at(-1);
			if (previous && file === FILE)
				previous.message += `\nNote (line ${lineNo}): ${message}`;
			continue;
		}
		// Errors reported inside robot.h are caused by the student's file; pin them to line 1.
		diagnostics.push({
			line: file === FILE ? Number(lineNo) : 1,
			column: file === FILE ? Number(column) : 1,
			severity: level === "warning" ? "warning" : "error",
			message: file === FILE ? message : `robot.h: ${message}`,
		});
	}
	return diagnostics;
}

function buildIssue(
	output: string,
	diagnostics: Diagnostic[],
	entries: string[],
	reading: string,
): RunIssue {
	const linkMissing = entries.find(
		(entry) =>
			output.includes(`undefined symbol: ${entry}`) ||
			output.includes(`symbol exported via --export not found: ${entry}`),
	);
	if (linkMissing) {
		return {
			kind: "missing-function",
			message: `Couldn't find \`double ${linkMissing}(double ${reading}, double target, double dt)\`. Check the name, the return type and the three parameters.`,
			detail: output,
		};
	}
	const first = diagnostics.find((d) => d.severity === "error");
	if (!first) {
		return { kind: "compile", message: "The compiler failed.", detail: output };
	}
	return {
		kind: "compile",
		message: `Line ${first.line}: ${friendlyClang(first.message)}`,
		detail: output,
		line: first.line,
	};
}

function friendlyClang(message: string): string {
	const first = message.split("\n")[0];
	if (first.startsWith("expected ';'"))
		return "missing a `;` at the end of the line.";
	const undeclared = first.match(/use of undeclared identifier '([^']+)'/);
	if (undeclared) {
		return `\`${undeclared[1]}\` isn't declared. Check the spelling, or declare it before you use it.`;
	}
	if (
		first.includes("functions that differ only in their return type") ||
		first.includes("conflicting types")
	) {
		return "`controller` has to return a `double`.";
	}
	if (first.startsWith("expected '}'"))
		return "a `{` is never closed. Check your braces.";
	return first;
}

/** Runs a built module once per variant. Each run gets a fresh instance, so globals reset. */
export async function runCpp(
	wasm: Uint8Array | WebAssembly.Module,
	{ spec, variants, entry }: Omit<RunRequest, "source">,
): Promise<RunResult[]> {
	const module =
		wasm instanceof WebAssembly.Module
			? wasm
			: await WebAssembly.compile(wasm as BufferSource);
	const results: RunResult[] = [];
	const { reading } = MECHANISMS[spec.mechanism];

	for (const variant of variants) {
		const recorder = new Recorder();
		const log = (line: string) => recorder.log(line);
		const wasi = new WASI(
			[],
			[],
			[
				new OpenFile(new File([])),
				ConsoleStdout.lineBuffered(log),
				ConsoleStdout.lineBuffered(log),
			],
		);
		let memory: WebAssembly.Memory | undefined;
		const readString = (ptr: number) => {
			if (!memory) return "";
			const bytes = new Uint8Array(memory.buffer);
			let end = ptr;
			while (end < bytes.length && bytes[end] !== 0 && end - ptr < 200) end++;
			return new TextDecoder().decode(bytes.subarray(ptr, end));
		};

		const fail = (issue: RunIssue): RunResult => ({
			variant,
			samples: [],
			plots: {},
			logs: recorder.logs,
			events: [],
			browned: false,
			issue,
		});

		let instance: WebAssembly.Instance;
		try {
			instance = await WebAssembly.instantiate(module, {
				wasi_snapshot_preview1: wasi.wasiImport,
				robot: {
					plot: (ptr: number, value: number) =>
						recorder.plot(readString(ptr), value),
				},
			});
			memory = instance.exports.memory as WebAssembly.Memory;
			wasi.initialize(
				instance as unknown as {
					exports: { memory: WebAssembly.Memory; _initialize?: () => unknown };
				},
			);
		} catch (error) {
			results.push(fail(trapIssue(error)));
			continue;
		}

		const fn = instance.exports[entry];
		if (typeof fn !== "function") {
			results.push(
				fail({
					kind: "missing-function",
					message: `Couldn't find \`double ${entry}(double ${reading}, double target, double dt)\`.`,
				}),
			);
			continue;
		}

		const controller = (measured: number, target: number, dt: number) => {
			try {
				return (fn as (m: number, t: number, d: number) => number)(
					measured,
					target,
					dt,
				);
			} catch (error) {
				throw new ControllerError(trapIssue(error));
			}
		};
		results.push(simulate(spec, variant, controller, recorder));
	}
	return results;
}

function trapIssue(error: unknown): RunIssue {
	const message = String((error as Error)?.message ?? error);
	if (/divide by zero/i.test(message)) {
		return {
			kind: "trap",
			message: "Your code crashed: it divided an integer by zero.",
			detail: message,
		};
	}
	if (/out of bounds/i.test(message)) {
		return {
			kind: "trap",
			message:
				"Your code crashed: it read memory it doesn't own, such as past the end of an array.",
			detail: message,
		};
	}
	if (/unreachable/i.test(message)) {
		return {
			kind: "trap",
			message: "Your code crashed (it hit `abort()` or undefined behavior).",
			detail: message,
		};
	}
	if (/call stack|recursion/i.test(message)) {
		return {
			kind: "trap",
			message: "Your code crashed: a function kept calling itself.",
			detail: message,
		};
	}
	return {
		kind: "trap",
		message: `Your code crashed: ${message}`,
		detail: message,
	};
}

/** Builds and runs in one go. Used by tests; the browser splits these across workers. */
export async function buildAndRunCpp(
	clang: ClangCommands,
	request: RunRequest,
): Promise<RunResponse> {
	const build = await compileCpp(
		clang,
		request.source,
		"build",
		[request.entry],
		MECHANISMS[request.spec.mechanism].reading,
	);
	if (!build.ok || !build.wasm) return { build, results: [] };
	const { wasm, ...rest } = build;
	return { build: rest, results: await runCpp(wasm, request) };
}
