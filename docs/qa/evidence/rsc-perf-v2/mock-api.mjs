// Test backend for the RSC v2 benchmark (copy of ../perf-hotfix/mock-api.mjs + CORS/Cache-Control + related_to). Original note: test backend for the perf benchmark: replays production public API responses (each unique GET fetched
// once, read-only, then served from a local snapshot) with Render-like limits:
// 1 uvicorn worker, DB pool 3 + overflow 1 => 4 concurrent requests, service times measured 2026-10-23.
import http from "node:http";
import fs from "node:fs";

const PORT = Number(process.env.PORT ?? 8790);
const UPSTREAM = "https://tunhuabinhnham-api.onrender.com";
const SNAPSHOT = new URL(process.env.SNAPSHOT ?? "./api-snapshot.json", import.meta.url);
const CONCURRENCY = Number(process.env.MOCK_CONCURRENCY ?? 4);
// Offline by default: a path missing from the snapshot is a 404 (counted in stats.misses), production is never called.
const UPSTREAM_OK = process.env.ALLOW_UPSTREAM === "1";
// Option D (`/products/{slug}?related=n`): same database statements as the product alone (test_product_with_related_in_one_response)
// plus serialising 4 more products (~9 ms each from the list endpoint): ~740 ms; 800 by default, D_MS=1000 = as slow as a list call.
const D_MS = Number(process.env.D_MS ?? 800);
const ZERO = process.env.ZERO === "1"; // no service time: the Worker's own render time (CPU proxy)
const snapshot = fs.existsSync(SNAPSHOT) ? JSON.parse(fs.readFileSync(SNAPSHOT, "utf8")) : {};
// Server-side ms (measured ttfb on a warm connection minus ~150 ms network).
const serviceMs = path => ZERO ? 0 : /^\/api\/v1\/products\/[^/?]+\?related=/.test(path) ? D_MS : /^\/api\/v1\/products\/[^/?]+/.test(path) ? 700 : path.startsWith("/api/v1/products") ? 1000
  : path.startsWith("/api/v1/posts") ? 850 : 470;

const fresh = () => ({ requests: 0, byPath: {}, waitMs: [], totalMs: [], waits: [], misses: [], peakActive: 0, peakInFlight: 0, busyMs: 0 });
let active = 0; const queue = []; const stats = fresh();
const acquire = () => new Promise(r => {
  stats.peakInFlight = Math.max(stats.peakInFlight, active + queue.length + 1); // requests at Render at once (served + queued)
  if (active < CONCURRENCY) { active++; r(); } else queue.push(r);
  stats.peakActive = Math.max(stats.peakActive, active);
});
const release = () => { const next = queue.shift(); if (next) next(); else active--; };

async function record(path) {
  if (snapshot[path]) return snapshot[path];
  const withRelated = /^\/api\/v1\/products\/([^/?]+)\?related=(\d+)$/.exec(path);
  if (withRelated) {
    const product = JSON.parse((await record(`/api/v1/products/${withRelated[1]}`)).body);
    const list = JSON.parse((await record(`/api/v1/products?category=${product.category?.slug ?? ""}&page_size=5`)).body);
    return { status: 200, location: null, body: JSON.stringify({ ...product, related: list.items.filter(p => p.id !== product.id).slice(0, Number(withRelated[2])) }) };
  }
  // Option B's API addition (not in production yet): same category as the product, the product excluded.
  const related = /^\/api\/v1\/products\?related_to=([^&]+)&page_size=(\d+)$/.exec(path);
  if (related) {
    const product = JSON.parse((await record(`/api/v1/products/${related[1]}`)).body);
    const list = JSON.parse((await record(`/api/v1/products?category=${product.category?.slug ?? ""}&page_size=${related[2]}`)).body);
    const items = list.items.filter(p => p.id !== product.id);
    return { status: 200, location: null, body: JSON.stringify({ ...list, items, total: items.length }) };
  }
  if (!UPSTREAM_OK) { stats.misses.push(path); return { status: 404, location: null, body: JSON.stringify({ error: { message: "not in snapshot" } }) }; }
  const res = await fetch(UPSTREAM + path, { redirect: "manual", headers: { "user-agent": "perf-audit-snapshot (read-only)" } });
  const entry = { status: res.status, location: res.headers.get("location"), body: await res.text() };
  snapshot[path] = entry; fs.writeFileSync(SNAPSHOT, JSON.stringify(snapshot));
  return entry;
}

http.createServer(async (req, res) => {
  if (req.url === "/__stats") { res.end(JSON.stringify({ ...stats, active, queued: queue.length })); return; }
  if (req.url === "/__reset") { Object.assign(stats, fresh()); res.end("ok"); return; }
  if (req.method !== "GET" || !req.url.startsWith("/api/v1/")) { res.writeHead(404).end(); return; }
  const start = Date.now();
  stats.requests++; stats.byPath[req.url] = (stats.byPath[req.url] ?? 0) + 1;
  await acquire();
  const waited = Date.now() - start;
  try {
    const entry = await record(req.url);
    stats.busyMs += serviceMs(req.url);
    await new Promise(r => setTimeout(r, serviceMs(req.url)));
    const headers = { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "public, max-age=60" }; // like the API: CORS for the site, 60 s browser cache
    if (entry.location) headers.location = entry.location.replace(UPSTREAM, `http://127.0.0.1:${PORT}`);
    res.writeHead(entry.status, headers).end(entry.body);
  } catch (error) {
    res.writeHead(502).end(JSON.stringify({ error: String(error) }));
  } finally {
    release(); stats.waitMs.push(waited); stats.waits.push([req.url, waited]); stats.totalMs.push(Date.now() - start);
  }
}).listen(PORT, "127.0.0.1", () => console.log(`mock api on ${PORT}, concurrency ${CONCURRENCY}`));
