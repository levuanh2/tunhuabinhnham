// Read-only client-navigation probe: per click, RSC request timing (TTFB / download / total, edge cache state)
// and what the visitor sees (first feedback, new content visible). One session per profile, real links only.
// Usage: node nav-probe.mjs <origin> <out.json> [profiles=chromium,chromium-mobile,webkit,webkit-mobile]
// "feedback" = first visible reaction after the click: a pending indicator ([data-nav-pending], aria-busy) or the
// new page itself. "content" = the target page's <h1> is in the DOM and the URL matches.
import { chromium, webkit, devices } from "playwright";
import fs from "node:fs";

const [origin, out, profileArg] = process.argv.slice(2);
const PROFILES = {
  chromium: [chromium, { viewport: { width: 1440, height: 900 } }],
  "chromium-mobile": [chromium, devices["Pixel 7"]],
  webkit: [webkit, { viewport: { width: 1440, height: 900 } }],
  "webkit-mobile": [webkit, devices["iPhone 13"]],
};
const names = (profileArg ?? Object.keys(PROFILES).join(",")).split(",");
// Real visitor path: header links, category tabs, a product, Back, Forward.
const STEPS = [
  ["link", "/san-pham"], ["tab", 0], ["tab", 1], ["link", "/san-pham"], ["product"], ["back"], ["forward"], ["back"],
  ["link", "/tin-tuc"], ["link", "/gioi-thieu"], ["link", "/lien-he"], ["home"],
];
const report = [];
// Optional test backend (docs/qa/evidence/perf-hotfix/mock-api.mjs): API calls made by each step.
const MOCK = process.env.MOCK;
const apiCalls = async () => MOCK ? (await (await fetch(`${MOCK}/__stats`)).json()).byPath : undefined;

for (const name of names) {
  const [engine, ctx] = PROFILES[name];
  const browser = await engine.launch();
  const page = await (await browser.newContext({ ...ctx, userAgent: (ctx.userAgent ?? "") + " nav-probe-read-only" })).newPage();
  const rsc = []; let prefetches = 0;
  page.on("response", async r => {
    const req = r.request(); const h = req.headers();
    if (h["next-router-prefetch"]) prefetches++;
    if (h.rsc !== "1") return;
    rsc.push({ url: new URL(r.url()).pathname + new URL(r.url()).search.replace(/[?&]_rsc=[^&]+/, ""), status: r.status(), cache: r.headers()["cf-cache-status"] ?? null, at: Date.now() });
  });
  const steps = [];
  try {
    await page.goto(origin + "/", { waitUntil: "networkidle", timeout: 60000 });
    for (const [kind, arg] of STEPS) {
      const mobile = (ctx.viewport?.width ?? 1440) < 1024;
      let target;
      if (kind === "link") {
        if (mobile) { await page.getByRole("button", { name: "Mở menu" }).click(); target = page.locator(`[aria-label="Menu di động"] a[href="${arg}"]`); }
        else target = page.locator(`nav[aria-label="Điều hướng chính"] a[href="${arg}"]`);
      } else if (kind === "tab") target = page.locator('nav[aria-label="Loại sản phẩm"] a[href^="/san-pham?category="]').nth(arg);
      else if (kind === "product") target = page.locator('main a[href^="/san-pham/"]').first();
      else if (kind === "home") target = page.locator('header a[href="/"]').first();
      const href = target ? await target.getAttribute("href") : null;
      const before = rsc.length;
      await page.evaluate(() => {
        const t0 = performance.now(); const state = { t0, feedback: null, h1: document.querySelector("main h1")?.textContent ?? "" };
        window.__nav = state;
        const check = () => {
          const now = performance.now();
          const pending = document.querySelector("[data-nav-pending], [aria-busy='true']");
          const h1 = document.querySelector("main h1")?.textContent ?? "";
          if (state.feedback === null && (pending || h1 !== state.h1)) state.feedback = now - t0;
          if (state.feedback === null || state.content === undefined) requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
        performance.clearResourceTimings();
      });
      if (MOCK) await fetch(`${MOCK}/__reset`);
      const t = Date.now();
      if (kind === "back") await page.goBack({ waitUntil: "commit" });
      else if (kind === "forward") await page.goForward({ waitUntil: "commit" });
      else await target.click();
      const expect = href ? (u => (u.pathname + u.search) === href) : null;
      if (expect) await page.waitForURL(expect, { timeout: 60000 });
      // content: target h1 present and changed (Back/Forward: URL changed and h1 rendered)
      await page.waitForFunction(() => { const h1 = document.querySelector("main h1"); return h1 && h1.textContent !== window.__nav.h1 || (h1 && !window.__nav.h1); }, null, { timeout: 60000, polling: "raf" }).catch(() => {});
      const content = Date.now() - t;
      const nav = await page.evaluate(() => {
        const e = performance.getEntriesByType("resource").filter(r => /[?&]_rsc=/.test(r.name));
        return { feedback: window.__nav.feedback, rsc: e.map(r => ({ ttfb: Math.round(r.responseStart - r.startTime), download: Math.round(r.responseEnd - r.responseStart), total: Math.round(r.responseEnd - r.startTime) })) };
      });
      await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
      steps.push({ step: kind === "tab" ? `tab ${href}` : `${kind}${href ? " " + href : ""}`, url: new URL(page.url()).pathname + new URL(page.url()).search,
        feedbackMs: nav.feedback === null ? null : Math.round(nav.feedback), contentMs: content, rsc: nav.rsc, api: await apiCalls(), edge: rsc.slice(before).map(r => `${r.status}:${r.cache}`) });
    }
    report.push({ name, ok: true, prefetches, steps });
    console.log(`${name}: prefetch=${prefetches}`);
    for (const s of steps) console.log(`  ${s.step.padEnd(38)} feedback ${String(s.feedbackMs).padStart(5)} content ${String(s.contentMs).padStart(5)} rsc ${JSON.stringify(s.rsc)} ${s.edge.join(",")}${s.api ? " api " + JSON.stringify(s.api) : ""}`);
  } catch (e) {
    report.push({ name, ok: false, unverified: true, error: String(e).split("\n")[0], steps });
    console.log(`UNVERIFIED ${name} ${String(e).split("\n")[0]}`);
  }
  await browser.close();
}
fs.writeFileSync(out, JSON.stringify({ origin, at: new Date().toISOString(), report }, null, 1));
