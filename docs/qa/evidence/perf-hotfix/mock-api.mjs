// Test backend for the perf benchmark: replays production public API responses (each unique GET fetched
// once, read-only, then served from a local snapshot) with Render-like limits:
// 1 uvicorn worker, DB pool 3 + overflow 1 => 4 concurrent requests, service times measured 2026-10-23.
import http from "node:http";
import fs from "node:fs";

const PORT = Number(process.env.PORT ?? 8790);
const UPSTREAM = "https://tunhuabinhnham-api.onrender.com";
const SNAPSHOT = new URL("./api-snapshot.json", import.meta.url);
const CONCURRENCY = Number(process.env.MOCK_CONCURRENCY ?? 4);
const snapshot = fs.existsSync(SNAPSHOT) ? JSON.parse(fs.readFileSync(SNAPSHOT, "utf8")) : {};
// Server-side ms (measured ttfb on a warm connection minus ~150 ms network).
const serviceMs = path => /^\/api\/v1\/products\/[^/?]+/.test(path) ? 700 : path.startsWith("/api/v1/products") ? 1000
  : path.startsWith("/api/v1/posts") ? 850 : 470;

let active = 0; const queue = []; const stats = { requests: 0, byPath: {}, waitMs: [], totalMs: [] };
const acquire = () => new Promise(r => { if (active < CONCURRENCY) { active++; r(); } else queue.push(r); });
const release = () => { const next = queue.shift(); if (next) next(); else active--; };

async function record(path) {
  if (snapshot[path]) return snapshot[path];
  const res = await fetch(UPSTREAM + path, { redirect: "manual", headers: { "user-agent": "perf-audit-snapshot (read-only)" } });
  const entry = { status: res.status, location: res.headers.get("location"), body: await res.text() };
  snapshot[path] = entry; fs.writeFileSync(SNAPSHOT, JSON.stringify(snapshot));
  return entry;
}

http.createServer(async (req, res) => {
  if (req.url === "/__stats") { res.end(JSON.stringify({ ...stats, active, queued: queue.length })); return; }
  if (req.url === "/__reset") { Object.assign(stats, { requests: 0, byPath: {}, waitMs: [], totalMs: [] }); res.end("ok"); return; }
  if (req.method !== "GET" || !req.url.startsWith("/api/v1/")) { res.writeHead(404).end(); return; }
  const start = Date.now();
  stats.requests++; stats.byPath[req.url] = (stats.byPath[req.url] ?? 0) + 1;
  await acquire();
  const waited = Date.now() - start;
  try {
    const entry = await record(req.url);
    await new Promise(r => setTimeout(r, serviceMs(req.url)));
    const headers = { "content-type": "application/json" };
    if (entry.location) headers.location = entry.location.replace(UPSTREAM, `http://127.0.0.1:${PORT}`);
    res.writeHead(entry.status, headers).end(entry.body);
  } catch (error) {
    res.writeHead(502).end(JSON.stringify({ error: String(error) }));
  } finally {
    release(); stats.waitMs.push(waited); stats.totalMs.push(Date.now() - start);
  }
}).listen(PORT, "127.0.0.1", () => console.log(`mock api on ${PORT}, concurrency ${CONCURRENCY}`));
