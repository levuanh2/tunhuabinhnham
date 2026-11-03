// Product-page benchmark for options A/B/C against a TEST origin (local Worker + mock API; no edge cache, so every
// view is a cache MISS render). N sessions open /san-pham, then all click a product at once.
//   main = product <h1> rendered; full = "Sản phẩm cùng loại" cards rendered (the visitor scrolls down right after
//   the main content: option C only fetches near the viewport).
// Usage: node product-bench.mjs <origin> <sessions> <label> <out.jsonl> [mock=http://127.0.0.1:8790]
import { chromium } from "playwright";
import fs from "node:fs";

const [origin, sessionsArg, label, out, mock = "http://127.0.0.1:8790"] = process.argv.slice(2);
const sessions = Number(sessionsArg);
const pct = (xs, p) => { const s = xs.filter(x => x != null).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))] : null; };
// Products whose category has other products (so every option has a related section to show).
const PRODUCTS = ["tu-nhua-4-canh-4", "tu-nhua-4-canh-3", "tu-nhua-4-canh-2", "tu-3-canh-3", "tu-4-canh-2"];

const browser = await chromium.launch();
const pages = await Promise.all(Array.from({ length: sessions }, async (_, id) => {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await page.goto(`${origin}/san-pham`, { waitUntil: "load", timeout: 120000 });
  return { id, page, slug: PRODUCTS[id % PRODUCTS.length] };
}));
await fetch(`${mock}/__reset`);
const results = await Promise.all(pages.map(async ({ id, page, slug }) => {
  const href = `/san-pham/${slug}`;
  // Same click as a visitor: the card link exists on /san-pham (all products fit one page).
  const link = page.locator(`main a[href="${href}"]`).first();
  const t = Date.now();
  try {
    await link.click();
    await page.locator("h1#ten-san-pham").waitFor({ timeout: 60000 });
    const main = Date.now() - t;
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    await page.locator("section", { hasText: "Sản phẩm cùng loại" }).locator("article").first().waitFor({ timeout: 30000 });
    const full = Date.now() - t;
    const rsc = await page.evaluate(() => performance.getEntriesByType("resource").filter(r => /[?&]_rsc=/.test(r.name)).map(r => Math.round(r.responseStart - r.startTime)).at(-1));
    return { id, slug, main, full, rscTtfb: rsc };
  } catch (e) { return { id, slug, error: String(e).split("\n")[0].slice(0, 120) }; }
}));
await Promise.all(pages.map(({ page }) => page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {})));
const stats = await (await fetch(`${mock}/__stats`)).json();
await browser.close();

const ok = results.filter(r => !r.error);
const row = {
  label, sessions, errors: results.length - ok.length,
  main: { p50: pct(ok.map(r => r.main), 50), p95: pct(ok.map(r => r.main), 95) },
  full: { p50: pct(ok.map(r => r.full), 50), p95: pct(ok.map(r => r.full), 95) },
  rscTtfb: { p50: pct(ok.map(r => r.rscTtfb), 50), p95: pct(ok.map(r => r.rscTtfb), 95) },
  apiCalls: stats.requests, apiPerView: +(stats.requests / sessions).toFixed(2), apiQueueWaitP95: pct(stats.waitMs, 95),
  apiByKind: Object.entries(stats.byPath).reduce((acc, [p, n]) => { const k = p.includes("related_to") ? "related_to" : p.includes("category=") ? "category" : p.replace(/\?.*/, "").replace(/products\/.+/, "products/{slug}"); acc[k] = (acc[k] ?? 0) + n; return acc; }, {}),
  failures: results.filter(r => r.error).map(r => `${r.slug}: ${r.error}`).slice(0, 3),
};
fs.appendFileSync(out, JSON.stringify(row) + "\n");
console.log(JSON.stringify(row));
