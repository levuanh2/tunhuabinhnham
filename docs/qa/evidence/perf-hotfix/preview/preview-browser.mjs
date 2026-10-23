// Read-only browser smoke of a Worker preview: Chromium/WebKit x desktop/mobile.
// Usage: node preview-browser.mjs <origin> <out.json>
import { chromium, webkit, devices } from "playwright";
import fs from "node:fs";

const [origin, out] = process.argv.slice(2);
const matrix = [
  ["chromium", chromium, { viewport: { width: 1440, height: 900 } }],
  ["chromium-mobile", chromium, devices["Pixel 7"]],
  ["webkit", webkit, { viewport: { width: 1440, height: 900 } }],
  ["webkit-mobile", webkit, devices["iPhone 13"]],
];
const report = []; let failures = 0;

for (const [name, engine, contextOptions] of matrix) {
  const browser = await engine.launch();
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const bad = [], consoleErrors = [], images = { requests: 0, failed: 0, redirects: 0 };
  let prefetches = 0;
  page.on("request", r => { if (r.headers()["next-router-prefetch"]) prefetches++; });
  page.on("response", r => {
    const u = new URL(r.url());
    if (u.pathname === "/_next/image") { images.requests++; if (r.status() >= 300 && r.status() < 400) images.redirects++; if (r.status() >= 400) images.failed++; }
    if (u.origin === origin && r.status() >= 400) bad.push(`${r.status()} ${u.pathname}${u.search.slice(0, 60)}`);
  });
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160)); });
  page.on("pageerror", e => consoleErrors.push(`pageerror ${String(e).slice(0, 160)}`));
  const pages = [];
  const visit = async (path) => {
    const res = await page.goto(origin + path, { waitUntil: "networkidle", timeout: 60000 });
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } scrollTo(0, 0); });
    await page.waitForLoadState("networkidle");
    const imgs = await page.evaluate(() => [...document.images].map(i => ({ src: i.currentSrc.slice(0, 80), ok: i.complete && i.naturalWidth > 0 })));
    const text = await page.locator("body").innerText();
    pages.push({ path, status: res?.status(), images: imgs.length, broken: imgs.filter(i => !i.ok).map(i => i.src), cfError: /Error 1102|Error 1027|Worker exceeded/i.test(text) });
  };
  for (const path of ["/", "/san-pham", "/san-pham?category=tu-quan-ao", "/tin-tuc", "/lien-he", "/gioi-thieu"]) await visit(path);
  // product detail + gallery, post detail: follow real links
  await page.goto(origin + "/san-pham", { waitUntil: "networkidle" });
  const productHref = await page.locator('a[href^="/san-pham/"]').first().getAttribute("href");
  await visit(productHref);
  const gallery = await page.locator('[aria-label*="ảnh" i] img, main img').count();
  await page.goto(origin + "/tin-tuc", { waitUntil: "networkidle" });
  const postHref = await page.locator('a[href^="/tin-tuc/"]').first().getAttribute("href").catch(() => null);
  if (postHref) await visit(postHref);
  // client navigation: category tabs
  await page.goto(origin + "/san-pham", { waitUntil: "networkidle" });
  const tabs = await page.locator('a[href^="/san-pham?category="]').evaluateAll(as => [...new Set(as.map(a => a.getAttribute("href")))]);
  const nav = [];
  for (const href of tabs.slice(0, 3)) {
    const t = Date.now(); await page.locator(`a[href="${href}"]`).first().click();
    await page.waitForURL(u => u.pathname + u.search === href, { timeout: 30000 }); nav.push({ href, ms: Date.now() - t });
  }
  await page.waitForLoadState("networkidle");
  const ok = bad.length === 0 && consoleErrors.length === 0 && images.failed === 0 && prefetches === 0 && pages.every(p => p.status === 200 && p.broken.length === 0 && !p.cfError);
  if (!ok) failures++;
  report.push({ name, ok, pages, productHref, postHref, gallery, nav, prefetches, images, bad, consoleErrors });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} pages=${pages.length} imgReq=${images.requests} imgFail=${images.failed} redirects=${images.redirects} prefetch=${prefetches} bad=${bad.length} console=${consoleErrors.length} nav=${nav.map(n => n.ms).join("/")}ms`);
  if (!ok) console.log(JSON.stringify({ broken: pages.filter(p => p.broken.length || p.status !== 200 || p.cfError), bad, consoleErrors }, null, 1).slice(0, 1500));
  await browser.close();
}
fs.writeFileSync(out, JSON.stringify(report, null, 1));
console.log(failures ? `BROWSER_SMOKE_FAIL ${failures}` : "BROWSER_SMOKE_PASS");
process.exit(failures ? 1 : 0);
