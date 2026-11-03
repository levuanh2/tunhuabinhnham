// CPU / wall time per request kind from raw `wrangler tail --format json` files (raw tails hold visitor IPs: not committed).
// Usage: node tail-compare.mjs <label>=<tail file>...
import fs from "node:fs";
const parse = t => { const ev = []; let d = 0, s = -1, q = false, e = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (e) e = false; else if (c === "\\") e = true; else if (c === '"') q = false; continue; }
    if (c === '"') q = true; else if (c === "{") { if (!d) s = i; d++; } else if (c === "}") { d--; if (!d) try { ev.push(JSON.parse(t.slice(s, i + 1))); } catch {} } }
  return ev; };
const pct = (a, q) => a.length ? a[Math.floor(q * (a.length - 1))] : null;
const stats = a => { a = a.filter(x => typeof x === "number").sort((x, y) => x - y); return { n: a.length, p50: pct(a, .5), p90: pct(a, .9), p99: pct(a, .99) }; };
const out = {};
for (const arg of process.argv.slice(2)) {
  const [label, file] = arg.split("=");
  // The gateway and the cached entrypoint each emit an event per request; keep every event, as the dashboard does.
  const ev = parse(fs.readFileSync(file, "utf8")).filter(x => x.event?.request);
  const kind = x => { const u = new URL(x.event.request.url); const h = x.event.request.headers ?? {};
    return u.pathname === "/_next/image" ? "image" : h.rsc ? "rsc" : u.pathname.startsWith("/admin") || u.pathname.startsWith("/api") ? "private" : "html"; };
  const r = { events: ev.length, versions: [...new Set(ev.map(x => x.scriptVersion?.id?.slice(0, 8)))], all: { cpu: stats(ev.map(x => x.cpuTime)), wall: stats(ev.map(x => x.wallTime)) } };
  for (const k of ["html", "rsc", "image"]) { const sub = ev.filter(x => kind(x) === k);
    r[k] = { cpu: stats(sub.map(x => x.cpuTime)), wall: stats(sub.map(x => x.wallTime)), renders: stats(sub.filter(x => x.cpuTime >= 20).map(x => x.wallTime)) }; }
  out[label] = r;
}
console.log(JSON.stringify(out, null, 1));
