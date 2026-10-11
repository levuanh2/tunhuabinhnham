// Lab-only Web Vitals (LCP/CLS/INP) on emulated mobile: 390px, 150ms RTT / 1.6 Mbps, CPU 4x. Not Lighthouse, not field data.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const b = await chromium.launch();
const rows = [];
for (const path of ["/", "/san-pham", "/san-pham/tu-5-tang", "/tin-tuc/chon-tu-phong-ngu"]) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable"); await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.addInitScript(() => {
    window.__v = { lcp: 0, cls: 0, inp: 0 };
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__v.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__v.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__v.inp = Math.max(window.__v.inp, e.duration); }).observe({ type: "event", buffered: true, durationThreshold: 16 });
  });
  const t0 = Date.now(); await page.goto("http://localhost:3100" + path, { waitUntil: "networkidle" }); const load = Date.now() - t0;
  await page.waitForTimeout(1500);
  const tap = path === "/" ? page.getByRole("button", { name: "Mở menu" }) : path === "/san-pham" ? page.getByRole("button", { name: /^Lọc/ }) : path.includes("tu-5") ? page.getByRole("button", { name: "Xem ảnh 2 trên 3" }) : null;
  if (tap) { await tap.tap(); await page.waitForTimeout(800); }
  const v = await page.evaluate(() => window.__v);
  const bytes = await page.evaluate(() => performance.getEntriesByType("resource").reduce((s, e) => s + (e.transferSize || 0), 0) + (performance.getEntriesByType("navigation")[0]?.transferSize || 0));
  rows.push({ path, LCP_ms: Math.round(v.lcp), CLS: +v.cls.toFixed(3), INP_ms: tap ? Math.round(v.inp) : "n/a", networkidle_ms: load, transfer_kB: Math.round(bytes / 1024) });
  await ctx.close();
}
await b.close(); console.table(rows); console.log(JSON.stringify(rows));
