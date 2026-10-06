import type { PyodideAPI } from "pyodide";
import { MECHANISMS } from "#/sim/robot";
import { Recorder, simulate } from "#/sim/simulate";
import { ControllerError, type RunIssue, type RunResult } from "#/sim/types";
import type {
	BuildResult,
	Diagnostic,
	RunRequest,
	RunResponse,
} from "../types";

import { ROBOT_PY, ROBOT_PYI } from "./files";

export { ROBOT_PY, ROBOT_PYI };

const FILE = "controller.py";

// Runs inside Pyodide. Kept small: the simulation itself is TypeScript.
const HELPERS = `
import linecache, traceback

def _pw_check(src):
    try:
        compile(src, "${FILE}", "exec")
        return None
    except SyntaxError as e:
        return [e.lineno or 1, e.offset or 1, e.end_lineno or 0, e.end_offset or 0, type(e).__name__, e.msg]

_pw_error = None

def _pw_load(src):
    global _pw_error
    linecache.cache["${FILE}"] = (len(src), None, src.splitlines(True), "${FILE}")
    ns = {"__name__": "controller", "__file__": "${FILE}"}
    try:
        exec(compile(src, "${FILE}", "exec"), ns)
    except BaseException as e:
        _pw_error = _pw_describe(e)
        raise
    return ns

def _pw_wrap(fn):
    def call(measured, target, dt):
        global _pw_error
        try:
            return fn(measured, target, dt)
        except BaseException as e:
            _pw_error = _pw_describe(e)
            raise
    return call

def _pw_take_error():
    global _pw_error
    e, _pw_error = _pw_error, None
    return e

def _pw_describe(e):
    frames = [f for f in traceback.extract_tb(e.__traceback__) if f.filename in ("${FILE}", "robot.py") or f.filename.endswith("/robot.py")]
    line = next((f.lineno for f in reversed(frames) if f.filename == "${FILE}"), None)
    text = "Traceback (most recent call last):\\n" + "".join(traceback.format_list(frames)) + "".join(traceback.format_exception_only(type(e), e))
    return [type(e).__name__, str(e), line, text]
`;

export interface PythonHarness {
	check(source: string): BuildResult;
	run(request: RunRequest): RunResponse;
}

/** Sets up a Pyodide instance for running student controllers. */
export function createPythonHarness(py: PyodideAPI): PythonHarness {
	let recorder: Recorder | null = null;
	py.registerJsModule("_robot_bridge", {
		plot: (name: string, value: number) => recorder?.plot(name, value),
	});
	py.FS.writeFile("/home/pyodide/robot.py", ROBOT_PY);
	py.setStdout({ batched: (text: string) => recorder?.log(text) });
	py.setStderr({ batched: (text: string) => recorder?.log(text) });
	py.runPython(HELPERS);

	// Looked up once: each globals.get() makes a new proxy.
	const helpers = new Map<string, ReturnType<typeof py.globals.get>>();
	const helper = (name: string) => {
		let fn = helpers.get(name);
		if (!fn) {
			fn = py.globals.get(name);
			helpers.set(name, fn);
		}
		return fn;
	};

	/** Turns a Python exception from the student's code into a RunIssue. */
	const describe = (error: unknown, reading: string): RunIssue => {
		const taken = helper("_pw_take_error")();
		if (taken) {
			const [type, text, line, detail] = taken.toJs() as [
				string,
				string,
				number | null,
				string,
			];
			taken.destroy();
			if (type === "KeyboardInterrupt") {
				return {
					kind: "timeout",
					message:
						"Your code took too long to finish. Look for a loop that never ends.",
				};
			}
			return {
				kind: "exception",
				message: friendlyPython(type, text, reading),
				detail,
				line: line ?? undefined,
			};
		}
		const raw = String((error as Error)?.message ?? error);
		return {
			kind: "exception",
			message: raw.trim().split("\n").at(-1) ?? raw,
			detail: raw,
		};
	};

	const check = (source: string): BuildResult => {
		const result = helper("_pw_check")(source);
		if (!result) return { ok: true, diagnostics: [], output: "" };
		const [line, column, endLine, endColumn, type, message] = result.toJs() as [
			number,
			number,
			number,
			number,
			string,
			string,
		];
		result.destroy();
		const diagnostic: Diagnostic = {
			line,
			column,
			endLine: endLine || undefined,
			endColumn: endColumn || undefined,
			severity: "error",
			message: `${type}: ${message}`,
		};
		return {
			ok: false,
			diagnostics: [diagnostic],
			output: `File "${FILE}", line ${line}\n${type}: ${message}`,
			issue: {
				kind: "compile",
				message: `Line ${line}: ${friendlySyntax(type, message)}`,
				line,
			},
		};
	};

	const run = ({ source, spec, variants, entry }: RunRequest): RunResponse => {
		const build = check(source);
		if (!build.ok) return { build, results: [] };
		const { reading } = MECHANISMS[spec.mechanism];

		let timedOut: RunIssue | undefined;
		const results: RunResult[] = variants.map((variant) => {
			recorder = new Recorder();
			const failed = (issue: RunIssue): RunResult => ({
				variant,
				samples: [],
				plots: {},
				logs: recorder?.logs ?? [],
				events: [],
				browned: false,
				issue,
			});

			// An infinite loop would hang every variant; stop after the first.
			if (timedOut) return failed(timedOut);

			let ns: ReturnType<typeof py.globals.get>;
			try {
				ns = helper("_pw_load")(source);
			} catch (error) {
				return failed(describe(error, reading));
			}
			const raw = ns.get(entry);
			if (!raw || typeof raw !== "function") {
				raw?.destroy?.();
				ns.destroy();
				return failed({
					kind: "missing-function",
					message: `Couldn't find \`def ${entry}(${reading}, target, dt):\`. Check the name.`,
				});
			}
			const fn = helper("_pw_wrap")(raw);
			raw.destroy();

			const controller = (measured: number, target: number, dt: number) => {
				try {
					const out = fn(measured, target, dt);
					if (out && typeof out === "object" && "destroy" in out) {
						const kind = String(out.type);
						out.destroy();
						return kind;
					}
					return out;
				} catch (error) {
					throw new ControllerError(describe(error, reading));
				}
			};

			try {
				const result = simulate(spec, variant, controller, recorder);
				if (result.issue?.kind === "timeout") timedOut = result.issue;
				return result;
			} finally {
				fn.destroy?.();
				ns.destroy();
			}
		});
		recorder = null;
		return { build, results };
	};

	return { check, run };
}

function friendlySyntax(type: string, message: string): string {
	if (type === "IndentationError") {
		return `the indentation is off (${message}). Python uses the spaces at the start of a line to group code.`;
	}
	if (message.includes("expected ':'"))
		return "missing a `:` at the end of the line.";
	if (message.includes("was never closed"))
		return `${message}. Check your brackets.`;
	return message;
}

function friendlyPython(
	type: string,
	message: string,
	reading: string,
): string {
	if (type === "UnboundLocalError") {
		const name = message.match(/variable '([^']+)'/)?.[1] ?? "the variable";
		return `Add \`global ${name}\` as the first line inside your function. Python needs it to change a variable that was made outside the function.`;
	}
	if (type === "NameError") {
		const name = message.match(/name '([^']+)'/)?.[1];
		return name
			? `\`${name}\` isn't defined. Check the spelling, or set it before you use it.`
			: message;
	}
	if (type === "ZeroDivisionError") return "Your code divided by zero.";
	if (type === "TypeError" && message.includes("positional argument")) {
		return `Your controller needs exactly three parameters: ${reading}, target and dt.`;
	}
	return `${type}: ${message}`;
}
