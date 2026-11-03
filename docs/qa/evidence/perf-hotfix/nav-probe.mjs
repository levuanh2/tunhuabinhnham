// Read-only, single-session navigation probe. Usage: node nav-probe.mjs <origin> [rounds]
import { chromium } from "playwright";

const origin = process.argv[2] ?? "https://tunhuabinhnham.com";
const rounds = Number(process.argv[3] ?? 2);
const browser = await chromium.launch();
const page = await browser.newPage({ userAgent: "Mozilla/5.0 (perf-audit; read-only) Chrome/140" });
const log = [];
page.on("requestfinished", async req => {
  const res = await req.response(); if (!res) return;
  const t = req.timing(); const u = new URL(req.url());
  const kind = u.pathname === "/_next/image" ? "img" : req.headers()["rsc"] === "1" ? "rsc" : res.request().resourceType();
  if (!["img", "rsc", "document"].includes(kind)) return;
  log.push({ kind, path: u.pathname + (kind === "img" ? "?" + decodeURIComponent(u.searchParams.get("url") ?? "").split("/").pop()?.slice(0, 8) + " w=" + u.searchParams.get("w") : u.search.replace(/&?_rsc=[^&]+/, "")),
    status: res.status(), cache: res.headers()["cf-cache-status"] ?? "-", cc: res.headers()["cache-control"] ?? "-",
    fromCache: res.fromServiceWorker() ? "sw" : (await res.headerValue("age")) ?? "", ttfb: Math.round(t.responseStart), total: Math.round(t.responseEnd) });
});
page.on("requestfailed", req => log.push({ kind: "FAIL", path: req.url().slice(0, 120), status: req.failure()?.errorText }));

const t0 = Date.now();
await page.goto(origin + "/san-pham", { waitUntil: "networkidle" });
const lcp = await page.evaluate(() => new Promise(r => new PerformanceObserver(l => { const e = l.getEntries(); r(Math.round(e[e.length - 1].startTime)); }).observe({ type: "largest-contentful-paint", buffered: true })));
console.log(`initial /san-pham load=${Date.now() - t0}ms LCP=${lcp}ms`);
const tabs = await page.locator('nav a[href*="category="], ul a[href*="category="]').evaluateAll(as => [...new Set(as.map(a => a.getAttribute("href")))]);
const targets = ["/san-pham", ...tabs].slice(0, 5);
const clicks = [];
for (let r = 0; r < rounds; r++) for (const href of targets) {
  const link = page.locator(`a[href="${href}"]`).first();
  if (!(await link.count())) continue;
  const start = Date.now();
  await link.click();
  await page.waitForURL(u => u.pathname + u.search === href, { timeout: 30000 });
  await page.waitForLoadState("networkidle");
  const imgsDone = await page.evaluate(() => [...document.images].filter(i => i.getBoundingClientRect().top < innerHeight).every(i => i.complete));
  clicks.push({ round: r, href, clickToIdleMs: Date.now() - start, aboveFoldImagesComplete: imgsDone });
}
console.table(clicks);
console.table(log);
const imgs = log.filter(l => l.kind === "img");
console.log(`image requests=${imgs.length} unique=${new Set(imgs.map(i => i.path)).size} non200=${imgs.filter(i => i.status !== 200).length}`);
await browser.close();
