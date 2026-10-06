#!/usr/bin/env node
// Browser check for the start flow: pick a language on the landing page, watch it
// download, land in level 1 with the runtime and language server already running.
// Also checks the graph legend doesn't move while the run plays back.
//   node scripts/smoke-start.mjs [baseUrl]

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

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (error) => console.log("page error:", error.message));
const log = (...args) => console.log(...args);
let failed = 0;
const check = (ok, message) => {
	if (!ok) failed++;
	log(`${ok ? "PASS" : "FAIL"} ${message}`);
};

for (const [lang, name, ready, server] of [
	["python", "Python", "Python ready", "basedpyright: checking as you type"],
	["cpp", "C++", "clang ready", "clangd: checking as you type"],
]) {
	await page.goto(base);
	// Clicks before React hydrates do nothing, so let the page settle first.
	await page.waitForLoadState("networkidle");
	await page.screenshot({ path: path.join(outDir, "home.png") });
	const started = Date.now();
	await page.locator(`a[href*="lang=${lang}"]`).first().click();
	const seen = new Set();
	while (!page.url().includes("/level/")) {
		const text = await page.locator("[aria-busy=true]").first().innerText().catch(() => "");
		const pct = text.match(/(\d+)%/)?.[1];
		if (pct) seen.add(Math.floor(Number(pct) / 25) * 25);
		if (Date.now() - started > 120_000) break;
		await page.waitForTimeout(100);
	}
	check(page.url().includes("/level/01-on-off"), `${lang}: opened level 1 after ${((Date.now() - started) / 1000).toFixed(1)} s (progress seen: ${[...seen].sort((a, b) => a - b).join(", ") || "none"}%)`);
	// Both should already be running: allow a moment for the page to render.
	const t0 = Date.now();
	await page.getByText(ready).waitFor({ timeout: 5000 }).catch(() => {});
	await page.getByText(server).waitFor({ timeout: 5000 }).catch(() => {});
	const readyNow = await page.getByText(ready).isVisible();
	const serverNow = await page.getByText(server).isVisible();
	check(readyNow && serverNow, `${lang}: runtime and language server ready on arrival (${Date.now() - t0} ms)`);

	// Header: level chips in the top bar, no Levels/Setup links.
	const headerChips = await page.locator("header nav[aria-label=Levels] a, header nav[aria-label=Levels] span[title]").count();
	const oldLinks = await page.locator("header a", { hasText: /^(Levels|Setup)$/i }).count();
	check(headerChips >= 11 && oldLinks === 0, `${lang}: level chips in the header (${headerChips}), old links gone (${oldLinks})`);
}

// Legend stability: run level 1's answer and sample the legend's label positions while it plays.
await page.goto(`${base}/level/01-on-off?instructor=1&lang=python`);
await page.getByText("Python ready").waitFor({ timeout: 60_000 });
await page.getByRole("button", { name: "Answer" }).click();
await page.getByRole("button", { name: "Use this code" }).click();
await page.getByRole("button", { name: "Run" }).click();
await page.getByText(/Level 1 complete/i).waitFor({ timeout: 30_000 });
await page.getByRole("button", { name: "Replay" }).click();
const positions = new Set();
const values = new Set();
for (let i = 0; i < 30; i++) {
	const box = await page.getByText("motor", { exact: true }).boundingBox();
	const timeBox = await page.locator("canvas[role=img]").locator("xpath=../..").locator("span").last().boundingBox();
	positions.add(`${Math.round(box?.x ?? -1)}|${Math.round(timeBox?.x ?? -1)}`);
	values.add(await page.locator("canvas[role=img]").locator("xpath=../..").innerText());
	await page.waitForTimeout(100);
}
check(positions.size === 1 && values.size > 5, `legend stays put while values change (${values.size} different readouts, ${positions.size} layout)`);
await page.locator("main").screenshot({ path: path.join(outDir, "legend.png") });
await page.locator("header").screenshot({ path: path.join(outDir, "header.png") });

// Before hydration (simulated with JavaScript off), the card is still a working link.
const noJs = await browser.newContext({ javaScriptEnabled: false });
const plain = await noJs.newPage();
await plain.goto(base);
await plain.locator('a[href*="lang=python"]').first().click();
await plain.waitForURL(/\/level\/01-on-off\?lang=python/, { timeout: 10_000 }).catch(() => {});
check(/\/level\/01-on-off\?lang=python/.test(plain.url()), `card works as a plain link before hydration (${plain.url().replace(base, "")})`);
await noJs.close();

await browser.close();
process.exit(failed ? 1 : 0);
