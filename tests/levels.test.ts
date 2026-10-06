import { createRequire } from "node:module";
import path from "node:path";
import { commands } from "@yowasp/clang";
import { loadPyodide } from "pyodide";
import { beforeAll, describe, expect, test } from "vitest";
import { grade } from "#/coach/grade";
import { ENTRY, LEVELS, type Level } from "#/levels";
import { buildAndRunCpp, type ClangCommands } from "#/runtimes/cpp/harness";
import { createPythonHarness, type PythonHarness } from "#/runtimes/python/harness";
import type { RunResponse } from "#/runtimes/types";
import type { Lang } from "#/sim/types";

let python: PythonHarness;
const clang = commands as unknown as ClangCommands;

beforeAll(async () => {
	// Under vitest, Pyodide can't find its own files without an explicit indexURL.
	const require = createRequire(import.meta.url);
	const indexURL = `${path.dirname(require.resolve("pyodide/package.json"))}/`;
	python = createPythonHarness(await loadPyodide({ indexURL }));
});

async function run(level: Level, lang: Lang, source: string): Promise<RunResponse> {
	const request = { source, spec: level.spec, variants: level.variants, entry: ENTRY };
	return lang === "python" ? python.run(request) : buildAndRunCpp(clang, request);
}

function summary(response: RunResponse, level: Level) {
	const g = grade(level, response.build, response.results);
	return { ...g, output: response.build.output };
}

for (const level of LEVELS) {
	describe(`${level.id}`, () => {
		for (const lang of ["python", "cpp"] as const) {
			test(`${lang}: the solution passes every variant`, async () => {
				const g = summary(await run(level, lang, level.solution[lang]), level);
				expect(g.output.includes("error:") ? g.output : "", "compiler errors").toBe("");
				expect({ passed: g.passed, message: g.message }).toMatchObject({ passed: true });
			});

			test(`${lang}: the starter doesn't pass yet`, async () => {
				const g = summary(await run(level, lang, level.starter[lang]), level);
				expect(g.title, g.message).not.toBe("Doesn't compile");
				if (level.id !== "11-match") expect(g.passed, g.message).toBe(false);
			});

			for (const wrong of level.wrongAnswers) {
				const source = wrong.code[lang];
				if (!source) continue;
				test(`${lang}: "${wrong.name}" fails with the right advice`, async () => {
					const g = summary(await run(level, lang, source), level);
					expect(g.passed).toBe(false);
					expect(g.message).toMatch(wrong.expect);
				});
			}
		}
	});
}
