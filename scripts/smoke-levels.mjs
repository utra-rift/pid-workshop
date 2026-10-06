#!/usr/bin/env node
// Passes every level in the browser with its reference answer, in both languages.
//   node scripts/smoke-levels.mjs [baseUrl]

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:3000";
const outDir = path.join(os.tmpdir(), "pid-smoke");
mkdirSync(outDir, { recursive: true });

function findChrome() {
	if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
	const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
	for (const dir of existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith("chromium-")) : []) {
		const app = path.join(cache, dir, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
		if (existsSync(app)) return app;
	}
	return undefined;
}

const LEVELS = [
	"01-on-off", "02-push", "03-brakes", "04-sag", "05-reload", "06-windup",
	"07-spin-up", "08-rapid-fire", "09-worn-wheels",
	"10-noisy-encoder", "11-brownout", "12-taking-hits", "13-sticky-gearbox", "14-match",
];
// Mid-run screenshots of the levels with something to see.
const SNAP_AT = {
	"05-reload": 2.4, "06-windup": 3.3, "07-spin-up": 0.6, "08-rapid-fire": 2.75, "09-worn-wheels": 3.2,
	"11-brownout": 0.5, "12-taking-hits": 3.05, "14-match": 7.5,
};

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (error) => console.log("page error:", error.message));

let failed = 0;
for (const lang of ["python", "cpp"]) {
	for (const level of LEVELS) {
		await page.goto(`${base}/level/${level}?instructor=1&lang=${lang}`);
		await page.getByText(lang === "cpp" ? "clang ready" : "Python ready").waitFor({ timeout: 240_000 });
		await page.getByRole("button", { name: "Answer" }).click();
		await page.getByRole("button", { name: "Use this code" }).click();
		await page.getByRole("button", { name: "Run" }).click();
		await page.waitForFunction(
			() => {
				const text = document.querySelector("section[aria-live]")?.textContent ?? "";
				return !text.includes("Hang on") && !text.includes("Press Run");
			},
			undefined,
			{ timeout: 30_000 },
		);
		const verdict = (await page.locator("section[aria-live]").innerText()).replace(/\s+/g, " ");
		const ok = /complete/i.test(verdict);
		if (!ok) failed++;
		console.log(`${ok ? "PASS" : "FAIL"} ${lang} ${level}${ok ? "" : `: ${verdict.slice(0, 160)}`}`);
		if (lang === "python" && SNAP_AT[level] !== undefined) {
			await page.getByRole("button", { name: "Replay" }).click();
			await page.waitForTimeout(SNAP_AT[level] * 1000);
			await page.locator("main").screenshot({ path: path.join(outDir, `${level}.png`) });
		}
	}
}
await browser.close();
console.log(failed ? `${failed} failed` : "All levels pass in both languages.");
process.exit(failed ? 1 : 0);
