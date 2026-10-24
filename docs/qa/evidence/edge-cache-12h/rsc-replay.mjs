// Captures real router (RSC) requests from a browser navigation (non-empty `_rsc`, Next's router headers) and replays
// them next to the HTML of the same path. On a Worker with Workers Cache (preview/production) it also proves the
// HTML and RSC variants never answer each other and that a repeated RSC request is a HIT with the 12 h header.
// Usage: node rsc-replay.mjs <origin> [out.json] ; read-only (GET), one browser session.
import { chromium } from "playwright";
import fs from "node:fs";

const [origin, out] = process.argv.slice(2);
const EDGE = "public, max-age=0, s-maxage=43200";
const ROUTER = ["rsc", "next-router-state-tree", "next-router-prefetch", "next-router-segment-prefetch", "next-url"];
const results = [];
const record = (name, pass, detail) => { results.push({ name, result: pass ? "PASS" : "FAIL", ...detail }); console.log(`${pass ? "PASS" : "FAIL"}  ${name} ${JSON.stringify(detail)}`); };

const browser = await chromium.launch();
const page = await browser.newPage();
const captured = [];
page.on("request", r => { if (/[?&]_rsc=/.test(r.url())) captured.push({ url: r.url(), headers: r.headers() }); });
await page.goto(`${origin}/san-pham`, { waitUntil: "networkidle" });
for (const link of await page.locator('nav[aria-label="Loại sản phẩm"] a[href^="/san-pham?category="]').all()) {
  await link.click(); await page.waitForLoadState("networkidle");
  if (captured.length >= 2) break;
}
await browser.close();

async function get(url, headers = {}) {
  const r = await fetch(url, { headers, redirect: "manual" });
  const body = await r.text();
  return { status: r.status, cc: r.headers.get("cache-control"), type: r.headers.get("content-type"), cache: r.headers.get("cf-cache-status"), vary: r.headers.get("vary"), html: body.trimStart().startsWith("<!DOCTYPE") || body.includes("<html") };
}
for (const { url, headers } of captured.slice(0, 2)) {
  const u = new URL(url); const rsc = u.searchParams.get("_rsc");
  const router = Object.fromEntries(Object.entries(headers).filter(([k]) => ROUTER.includes(k)));
  const htmlUrl = new URL(url); htmlUrl.searchParams.delete("_rsc");
  const tag = `${u.pathname}${u.search.replace(/_rsc=[^&]+/, "_rsc=…")}`;
  record(`captured router request ${tag}`, !!rsc && !!router.rsc && !!router["next-router-state-tree"], { rscLength: rsc?.length ?? 0, routerHeaders: Object.keys(router) });
  const a = await get(url, router); const b = await get(url, router);
  record("RSC replay: x-component, 12 h, Vary router headers", a.status === 200 && /text\/x-component/.test(a.type ?? "") && a.cc === EDGE && ROUTER.slice(0, 4).every(h => (a.vary ?? "").toLowerCase().includes(h)), { status: a.status, type: a.type, cc: a.cc });
  record("RSC repeated: same variant (HIT where Workers Cache exists)", b.status === 200 && /text\/x-component/.test(b.type ?? "") && !b.html, { first: a.cache, second: b.cache });
  const h = await get(htmlUrl.href);
  record("HTML of the same path: HTML, 12 h, never the RSC payload", h.status === 200 && /text\/html/.test(h.type ?? "") && h.html && h.cc === EDGE, { type: h.type, cc: h.cc, cache: h.cache });
  const bare = await get(url);
  record("RSC URL without router headers: not stored", bare.status === 307 || !/public/.test(bare.cc ?? ""), { status: bare.status, cc: bare.cc });
  const forged = await get(url, { ...router, "next-router-state-tree": encodeURIComponent(JSON.stringify(["", { children: ["__PAGE__", {}] }, null, null, true])) });
  record("RSC URL with other router state: rejected or not public", forged.status === 307 || forged.status === 400 || !/public/.test(forged.cc ?? ""), { status: forged.status, cc: forged.cc, type: forged.type });
  const after = await get(url, router);
  record("RSC after the HTML request: still the RSC payload", /text\/x-component/.test(after.type ?? "") && !after.html, { cache: after.cache });
}
const verdict = results.length && results.every(r => r.result === "PASS") ? "RSC_REPLAY_PASS" : "RSC_REPLAY_FAIL";
if (out) fs.writeFileSync(out, JSON.stringify({ verdict, origin, at: new Date().toISOString(), results }, null, 1));
console.log(verdict);
