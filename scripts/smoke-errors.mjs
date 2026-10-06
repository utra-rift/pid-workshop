#!/usr/bin/env node
// Browser checks for the unhappy paths: errors, crashes and infinite loops.
//   node scripts/smoke-errors.mjs [baseUrl]

import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import lz from "lz-string";
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:3000";

function findChrome() {
	if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
	const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
	for (const dir of existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith("chromium-")) : []) {
		const app = path.join(cache, dir, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
		if (existsSync(app)) return app;
	}
	return undefined;
}

const CASES = [
	{
		name: "Python: forgot global",
		lang: "python",
		level: "03-brakes",
		code: "kP = 0.6\nkD = 0.08\nlast_error = 0.0\n\n\ndef controller(angle, target, dt):\n    error = target - angle\n    derivative = (error - last_error) / dt\n    last_error = error\n    return kP * error + kD * derivative\n",
		expect: /global last_error/,
		marker: true,
	},
	{
		name: "Python: syntax error",
		lang: "python",
		level: "01-on-off",
		code: "def controller(angle, target, dt)\n    return 0\n",
		expect: /Line 1/,
		marker: true,
	},
	{
		name: "Python: infinite loop",
		lang: "python",
		level: "01-on-off",
		code: "def controller(angle, target, dt):\n    while True:\n        pass\n",
		expect: /never ends|didn't finish/,
	},
	{
		name: "C++: missing semicolon",
		lang: "cpp",
		level: "01-on-off",
		code: '#include "robot.h"\n\ndouble controller(double angle, double target, double dt) {\n  return 0\n}\n',
		expect: /missing a `?;`?/,
		marker: true,
	},
	{
		name: "C++: wrong function name",
		lang: "cpp",
		level: "01-on-off",
		code: '#include "robot.h"\n\ndouble control(double angle, double target, double dt) {\n  return 0;\n}\n',
		expect: /Couldn't find/,
	},
	{
		name: "C++: infinite loop",
		lang: "cpp",
		level: "01-on-off",
		code: '#include "robot.h"\n\nvolatile int spin = 1;\n\ndouble controller(double angle, double target, double dt) {\n  while (spin) {}\n  return 0;\n}\n',
		expect: /never ends|didn't finish/,
	},
	{
		name: "C++: printf shows in the console",
		lang: "cpp",
		level: "01-on-off",
		code: '#include "robot.h"\n#include <cstdio>\n\nint calls = 0;\n\ndouble controller(double angle, double target, double dt) {\n  if (calls++ == 0) printf("first call: angle=%.1f target=%.1f\\n", angle, target);\n  return angle < target ? 6 : 0;\n}\n',
		expect: /complete/i,
		console: /first call: angle=0\.0 target=60\.0/,
	},
];

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (error) => console.log("page error:", error.message));

let failed = 0;
for (const c of CASES) {
	// Load the case's code through a share link, which the app reads from the hash.
	await page.goto(`${base}/level/${c.level}?instructor=1&lang=${c.lang}#code=${lz.compressToEncodedURIComponent(c.code)}`);
	await page.getByText(c.lang === "cpp" ? "clang ready" : "Python ready").waitFor({ timeout: 240_000 });
	await page.waitForTimeout(300);
	const started = Date.now();
	await page.getByRole("button", { name: "Run" }).click();
	const verdict = page.locator("section[aria-live]");
	// Wait for a verdict: not idle ("Press Run") and not running ("Hang on").
	await page.waitForFunction(
		() => {
			const text = document.querySelector("section[aria-live]")?.textContent ?? "";
			return !text.includes("Hang on") && !text.includes("Press Run");
		},
		undefined,
		{ timeout: 30_000 },
	);
	await page.waitForTimeout(200);
	const text = (await verdict.innerText()).replace(/\s+/g, " ");
	const consoleText = await page.locator("[role=log]").innerText();
	const markers = await page.locator(".monaco-editor .squiggly-error").count();
	const ok = c.expect.test(text) && (!c.console || c.console.test(consoleText)) && (!c.marker || markers > 0);
	if (!ok) failed++;
	console.log(
		`${ok ? "PASS" : "FAIL"} ${c.name} (${((Date.now() - started) / 1000).toFixed(1)} s): ${text.slice(0, 160)}${c.marker ? ` [underlines: ${markers}]` : ""}${!ok && c.console ? `\n  console: ${consoleText.slice(0, 200)}` : ""}`,
	);
}

await browser.close();
process.exit(failed ? 1 : 0);
