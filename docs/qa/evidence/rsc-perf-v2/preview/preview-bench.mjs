// Light A/B benchmark on the real stack (Cloudflare + Render + Supabase), NOT a load test: 2 browser sessions at once,
// 3 product pages each, every page loaded twice (a unique `?bench=` query makes the first load a cache MISS render,
// the second a HIT of the same key). Pause between pages. Read-only.
// Usage: node preview-bench.mjs <label> <origin> <out.jsonl> [slugs comma-separated]
import { chromium } from "playwright";
import fs from "node:fs";

const [label, origin, out, slugArg] = process.argv.slice(2);
const slugs = (slugArg ?? "tu-nhua-4-canh-4,tu-nhua-4-canh-3,tu-4-canh-2").split(",");
const run = Date.now().toString(36);
const browser = await chromium.launch();
const sessions = await Promise.all([0, 1].map(async id => {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const rows = [];
  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[(i + id) % slugs.length];
    const url = `${origin}/san-pham/${slug}?bench=${run}-${id}-${i}`;
    for (const pass of ["miss", "hit"]) {
      const t = Date.now();
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.locator("h1#ten-san-pham").waitFor({ timeout: 90000 });
      const main = Date.now() - t;
      const related = await page.locator("section", { hasText: "Sản phẩm cùng loại" }).locator("article").count();
      const nav = await page.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; return { ttfb: Math.round(n.responseStart - n.startTime), total: Math.round(n.responseEnd - n.startTime) }; });
      rows.push({ session: id, slug, pass, cache: response?.headers()["cf-cache-status"] ?? null, ray: (response?.headers()["cf-ray"] ?? "").split("-").pop(), status: response?.status(), ttfb: nav.ttfb, html: nav.total, main, relatedCards: related, at: new Date(t).toISOString() });
      await page.waitForTimeout(2000);
    }
  }
  return rows;
}));
await browser.close();
const rows = sessions.flat();
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };
const summary = pass => { const r = rows.filter(x => x.pass === pass); return { n: r.length, cache: [...new Set(r.map(x => x.cache))], ttfb: { p50: pct(r.map(x => x.ttfb), 50), max: Math.max(...r.map(x => x.ttfb)) }, main: { p50: pct(r.map(x => x.main), 50), max: Math.max(...r.map(x => x.main)) }, relatedCards: [...new Set(r.map(x => x.relatedCards))] }; };
const result = { label, origin, run, at: new Date().toISOString(), miss: summary("miss"), hit: summary("hit"), rows };
fs.appendFileSync(out, JSON.stringify(result) + "\n");
console.log(JSON.stringify({ label, miss: result.miss, hit: result.hit }));
