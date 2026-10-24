// Mixed-load benchmark for the "Sản phẩm cùng loại" options (A/B/C/D) against a TEST origin: local Worker (workerd, no
// edge cache: every response is a MISS render) + mock-api.mjs (production data and service times, 4 connections).
// S sessions navigate at once, alternating a product page and another public route (seeded think time 0.5–2 s), as RSC
// client navigations. The Worker buffers each response, so its arrival = the content on screen (minus browser paint).
//   product main = product RSC arrived; product full = related products available (= main, except option C: the browser
//   then calls the API itself, here every view scrolls to it, no browser cache: worst case for C).
//   other = every other route, to see what the product page's backend calls cost the other visitors.
// Usage: node load-mix.mjs <origin> <sessions> <label> <out.jsonl> [client-related] ; env ROUNDS (8), THINK=0, RATE, DURATION, MOCK
import fs from "node:fs";

const [origin, sessionsArg, label, out, mode] = process.argv.slice(2);
const sessions = Number(sessionsArg), rounds = Number(process.env.ROUNDS ?? 8), mock = process.env.MOCK ?? "http://127.0.0.1:8790";
const think = process.env.THINK === "0" ? () => 0 : rand => 500 + rand() * 1500;
const PRODUCTS = { "tu-nhua-4-canh-4": "tu-4-canh", "tu-nhua-4-canh-3": "tu-4-canh", "tu-nhua-4-canh-2": "tu-4-canh", "tu-3-canh-3": "tu-3-canh", "tu-4-canh-2": "tu-4-canh" };
const OTHERS = ["/san-pham", "/san-pham?category=tu-4-canh", "/tin-tuc", "/", "/san-pham?category=tu-quan-ao", "/gioi-thieu", "/lien-he"];
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))] : null; };
const mulberry32 = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function rsc(path) {
  const t = Date.now();
  const res = await fetch(origin + path + (path.includes("?") ? "&" : "?") + "_rsc=" + Math.random().toString(36).slice(2, 7), { headers: { RSC: "1" } });
  const body = await res.text();
  // A render with a failed API call is not edge-cacheable (worker.ts): count them, they would hide a broken page.
  return { ms: Date.now() - t, status: res.status, cacheable: /s-maxage=\d+/.test(res.headers.get("cache-control") ?? ""), body };
}

await fetch(`${mock}/__reset`);
const views = [];
const start = Date.now();
// RATE=<views/s>: open loop instead, the same seeded arrivals for every option (Poisson, product/other alternating,
// DURATION s), so a faster option does not get more traffic than a slower one.
const RATE = Number(process.env.RATE ?? 0);
async function productView(slug) {
  const page = await rsc(`/san-pham/${slug}`);
  const view = { kind: "product", path: `/san-pham/${slug}`, main: page.ms, full: page.ms, status: page.status, cacheable: page.cacheable, related: page.body.includes("Sản phẩm cùng loại") };
  if (mode === "client-related") {
    const t = Date.now();
    const related = await fetch(`${mock}/api/v1/products?category=${PRODUCTS[slug]}&page_size=5`);
    await related.text();
    view.full = page.ms + (Date.now() - t); view.related = related.ok;
  }
  views.push(view);
}
async function otherView(path) { const o = await rsc(path); views.push({ kind: "other", path, main: o.ms, full: o.ms, status: o.status, cacheable: o.cacheable }); }
if (RATE) {
  const rand = mulberry32(42), slugs = Object.keys(PRODUCTS), fired = [];
  for (let at = 0, i = 0; at < Number(process.env.DURATION ?? 60) * 1000; at += -Math.log(1 - rand()) * 1000 / RATE, i++) {
    const delay = at - (Date.now() - start); if (delay > 0) await sleep(delay);
    fired.push(i % 2 ? otherView(OTHERS[(i >> 1) % OTHERS.length]) : productView(slugs[(i >> 1) % slugs.length]));
  }
  await Promise.all(fired);
} else await Promise.all(Array.from({ length: sessions }, async (_, id) => {
  const rand = mulberry32(id + 1);
  await sleep(rand() * 500);
  for (let r = 0; r < rounds; r++) {
    const slugs = Object.keys(PRODUCTS);
    await productView(slugs[(id + r) % slugs.length]);
    await sleep(think(rand));
    await otherView(OTHERS[(id * 3 + r) % OTHERS.length]);
    await sleep(think(rand));
  }
}));
const wall = Date.now() - start;
const stats = await (await fetch(`${mock}/__stats`)).json();

const of = kind => views.filter(v => v.kind === kind);
const kindOf = p => p.includes("related_to") ? "related_to" : p.includes("?related=") ? "product+related" : p.includes("category=") && p.includes("page_size=5") ? "related(category)" : p.replace(/\?.*/, "").replace(/products\/.+/, "products/{slug}");
const waitsBy = {};
for (const [p, w] of stats.waits) (waitsBy[kindOf(p)] ??= []).push(w);
const row = {
  label, sessions: RATE ? `${RATE}/s` : sessions, rounds: RATE ? null : rounds, views: views.length, wallS: +(wall / 1000).toFixed(1),
  productMain: { p50: pct(of("product").map(v => v.main), 50), p95: pct(of("product").map(v => v.main), 95) },
  productFull: { p50: pct(of("product").map(v => v.full), 50), p95: pct(of("product").map(v => v.full), 95) },
  other: { p50: pct(of("other").map(v => v.main), 50), p95: pct(of("other").map(v => v.main), 95) },
  otherByRoute: Object.fromEntries(OTHERS.map(r => [r, pct(of("other").filter(v => v.path === r).map(v => v.main), 95)])),
  bad: { non200: views.filter(v => v.status !== 200).length, notCacheable: views.filter(v => !v.cacheable).length, productWithoutRelated: of("product").filter(v => !v.related).length , paths: views.filter(v => v.status !== 200 || !v.cacheable || (v.kind === "product" && !v.related)).map(v => `${v.path} ${v.status}${v.cacheable ? "" : " degraded"} ${v.main}ms`).slice(0, 5) },
  api: {
    calls: stats.requests, perView: +(stats.requests / views.length).toFixed(2), misses: stats.misses.length,
    peakActive: stats.peakActive, peakInFlight: stats.peakInFlight, busyS: +(stats.busyMs / 1000).toFixed(1),
    queueWait: { p50: pct(stats.waitMs, 50), p95: pct(stats.waitMs, 95), max: Math.max(0, ...stats.waitMs) },
    queueWaitP95By: Object.fromEntries(Object.entries(waitsBy).map(([k, w]) => [k, pct(w, 95)])),
    byKind: Object.entries(stats.byPath).reduce((acc, [p, n]) => { const k = kindOf(p); acc[k] = (acc[k] ?? 0) + n; return acc; }, {}),
  },
};
fs.appendFileSync(out, JSON.stringify(row) + "\n");
console.log(JSON.stringify(row));
