// Concurrent-session navigation benchmark against a TEST origin (local Worker + mock API).
// Usage: node bench.mjs <origin> <sessions> <label> [mockStatsUrl]
import { chromium } from "playwright";
import fs from "node:fs";

const [origin, sessionsArg, label, mock = "http://127.0.0.1:8790"] = process.argv.slice(2);
const sessions = Number(sessionsArg);
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))] : NaN; };

await fetch(`${mock}/__reset`);
const browser = await chromium.launch();
const clicks = [], loads = [], rscTtfb = [], imgTtfb = [];
let rsc = 0, prefetch = 0, img = 0, imgFail = 0, errors = 0;

async function session(id) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on("requestfinished", async req => {
    const res = await req.response(); const t = req.timing();
    if (new URL(req.url()).pathname === "/_next/image") { img++; imgTtfb.push(t.responseStart); if (res && res.status() >= 400) imgFail++; return; }
    const h = req.headers();
    if (h.rsc === "1") { rsc++; if (h["next-router-prefetch"]) prefetch++; else rscTtfb.push(t.responseStart); }
  });
  page.on("requestfailed", req => { if (new URL(req.url()).pathname === "/_next/image") imgFail++; });
  try {
    let t = Date.now();
    await page.goto(origin + "/san-pham", { waitUntil: "load", timeout: 60000 });
    loads.push(Date.now() - t);
    const tabs = await page.locator('a[href^="/san-pham?category="]').evaluateAll(as => [...new Set(as.map(a => a.getAttribute("href")))]);
    for (const href of [...tabs.slice(0, 4), "/san-pham"]) {
      await page.waitForTimeout(800); // user think time; viewport prefetches run meanwhile
      t = Date.now();
      await page.locator(`a[href="${href}"]`).first().click();
      await page.waitForURL(u => u.pathname + u.search === href, { timeout: 60000 });
      clicks.push({ id, href, ms: Date.now() - t });
    }
    const product = page.locator('a[href^="/san-pham/"]').first();
    if (await product.count()) {
      const href = await product.getAttribute("href");
      await page.waitForTimeout(800);
      t = Date.now(); await product.click(); await page.waitForURL(u => u.pathname === href, { timeout: 60000 });
      clicks.push({ id, href: "product", ms: Date.now() - t });
    }
    await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  } catch (e) { errors++; console.error(`session ${id}:`, String(e).split("\n")[0]); }
  await context.close();
}

const wall = Date.now();
await Promise.all(Array.from({ length: sessions }, (_, i) => session(i)));
const stats = await (await fetch(`${mock}/__stats`)).json();
await browser.close();
const ms = clicks.map(c => c.ms);
const result = {
  label, sessions, wallMs: Date.now() - wall, errors,
  initialLoad: { p50: pct(loads, 50), p95: pct(loads, 95) },
  clickToRender: { n: ms.length, p50: pct(ms, 50), p95: pct(ms, 95), max: Math.max(...ms) },
  rscRequests: rsc, prefetchRequests: prefetch, rscNavTtfb: { p50: Math.round(pct(rscTtfb, 50)), p95: Math.round(pct(rscTtfb, 95)) },
  imageRequests: img, imageFailures: imgFail, imageTtfb: { p50: Math.round(pct(imgTtfb, 50)), p95: Math.round(pct(imgTtfb, 95)) },
  api: { calls: stats.requests, perSession: +(stats.requests / sessions).toFixed(1), queueWaitP50: pct(stats.waitMs, 50), queueWaitP95: pct(stats.waitMs, 95), latencyP95: pct(stats.totalMs, 95) },
};
console.log(JSON.stringify(result));
fs.appendFileSync(process.env.BENCH_OUT, JSON.stringify(result) + "\n");
