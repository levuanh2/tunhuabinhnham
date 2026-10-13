#!/usr/bin/env node
// Version-skew simulation: HTML from one Worker version, every /_next/static request answered by ANOTHER
// version (as during a Cloudflare rollout, 2026-10-13 14:13:51–14:15:03Z). Both are real local Workers
// (wrangler dev / workerd) running different builds against the fixture API.
//
//   node e2e/skew/simulate-skew.mjs <html origin> <asset origin> <label>
//
// Exit code 1 when any asset request fails or the page is unstyled.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium, webkit } = require("@playwright/test");

const [htmlOrigin, assetOrigin, label = "run"] = process.argv.slice(2);
const pages = ["/", "/san-pham", "/san-pham/tu-5-tang", "/tin-tuc"];
const result = { label, htmlOrigin, assetOrigin, pages: [] };

for (const [engineName, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  const browser = await engine.launch();
  for (const path of pages) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const failed = [];
    // Route every hashed asset to the other version, exactly like an edge that still runs it.
    await page.route("**/_next/static/**", async route => {
      const url = new URL(route.request().url());
      const response = await fetch(assetOrigin + url.pathname + url.search);
      if (!response.ok) failed.push(`${response.status} ${url.pathname}`);
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message.slice(0, 100)));
    await page.goto(htmlOrigin + path, { waitUntil: "networkidle" });
    // Styled = the design system's body font and background are applied (Tailwind CSS loaded).
    const styled = await page.evaluate(() => {
      const css = getComputedStyle(document.body);
      return css.fontFamily.includes("Vietnam") && css.backgroundColor !== "rgba(0, 0, 0, 0)";
    });
    result.pages.push({ engine: engineName, path, styled, failedAssets: failed, pageErrors: errors.length });
    await page.close();
  }
  await browser.close();
}
const failures = result.pages.filter(p => !p.styled || p.failedAssets.length);
result.summary = { checked: result.pages.length, unstyled: result.pages.filter(p => !p.styled).length, failedAssetRequests: result.pages.reduce((n, p) => n + p.failedAssets.length, 0), verdict: failures.length ? "SKEW_BREAKS_PAGES" : "NO_SKEW_FAILURE" };
console.log(JSON.stringify(result, null, 1));
process.exit(failures.length ? 1 : 0);
