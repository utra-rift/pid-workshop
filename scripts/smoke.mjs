#!/usr/bin/env node
// Browser smoke test: passes a level in each language and checks the language
// servers start. Needs a running dev server.
//
//   node scripts/smoke.mjs [baseUrl] [level] [langs]
//   node scripts/smoke.mjs http://localhost:3000 01-on-off python,cpp
//
// Uses Playwright's cached Chromium, or CHROME_PATH.

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:3000";
const levelId = process.argv[3] ?? "01-on-off";
const langs = (process.argv[4] ?? "python,cpp").split(",");
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

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
if (process.env.DEBUG_LSP) await page.addInitScript(() => localStorage.setItem("pid:debug-lsp", "1"));
const log = (...args) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);
page.on("console", (msg) => {
	if (["error", "warning"].includes(msg.type()) || (process.env.DEBUG_LSP && msg.text().startsWith("["))) {
		log(`page ${msg.type()}:`, msg.text().slice(0, Number(process.env.DEBUG_LSP) > 1 ? 4000 : 300));
	}
});
page.on("pageerror", (error) => log("page error:", error.message));
page.on("worker", (worker) => {
	log("worker started:", worker.url().replace(base, "").slice(0, 100));
	worker.on("console", (msg) => log(`worker ${msg.type()}:`, msg.text().slice(0, 300)));
	worker.on("close", () => log("worker closed:", worker.url().replace(base, "").slice(0, 100)));
});

let failed = false;
for (const lang of langs) {
	log(`--- ${lang} ---`);
	await page.goto(`${base}/level/${levelId}?instructor=1&lang=${lang}`);
	const isolated = await page.evaluate(() => crossOriginIsolated);
	log("crossOriginIsolated:", isolated);

	const ready = lang === "cpp" ? "clang ready" : "Python ready";
	await page.getByText(ready).waitFor({ timeout: 240_000 });
	log(ready);

	await page.getByRole("button", { name: "Answer" }).click();
	await page.getByRole("button", { name: "Use this code" }).click();
	await page.getByRole("button", { name: "Run" }).click();
	try {
		await page.getByText(/Level \d+ complete/i).waitFor({ timeout: 60_000 });
		log("PASS: level complete");
	} catch {
		failed = true;
		log("FAIL: no pass verdict. Verdict text:", await page.locator("section[aria-live]").innerText());
	}

	const server = lang === "cpp" ? "clangd: checking as you type" : "basedpyright: checking as you type";
	try {
		await page.getByText(server).waitFor({ timeout: 240_000 });
		log(`language server ready (${server})`);
	} catch {
		failed = true;
		const status = await page.locator("text=/clangd|basedpyright/").first().innerText().catch(() => "?");
		log(`FAIL: language server not ready: ${status}`);
	}
	// Type a mistake at the end of the file and wait for the server to underline it.
	await page.locator(".monaco-editor .view-lines").click();
	await page.keyboard.press("ControlOrMeta+End");
	await page.keyboard.press("Enter");
	await page.keyboard.press("Escape");
	await page.keyboard.type(lang === "cpp" ? "int broken = notDeclared;" : "broken = not_declared", { delay: 40 });
	await page.keyboard.press("Escape");
	try {
		await page.locator(".monaco-editor .squiggly-error").first().waitFor({ timeout: 30_000 });
		const count = await page.locator(".monaco-editor .squiggly-error").count();
		log(`PASS: live diagnostics (${count} error underline${count === 1 ? "" : "s"})`);
	} catch {
		failed = true;
		log("FAIL: no error underline from the language server");
	}

	// Completion: start typing a helper name and check the suggest widget.
	await page.keyboard.press("End");
	await page.keyboard.press("Enter");
	await page.keyboard.type(lang === "cpp" ? "toRad" : "contr", { delay: 40 });
	await page.keyboard.press("Control+Space");
	try {
		await page.locator(".suggest-widget .monaco-list-row").first().waitFor({ timeout: 15_000 });
		const first = await page.locator(".suggest-widget .monaco-list-row").first().innerText();
		log(`PASS: completion (${first.split("\n")[0]})`);
	} catch {
		log("WARN: no completion list");
	}
	await page.keyboard.press("Escape");

	await page.screenshot({ path: path.join(outDir, `${lang}.png`), fullPage: true });
	log("screenshot:", path.join(outDir, `${lang}.png`));
}

await browser.close();
process.exit(failed ? 1 : 0);
