// Controlled MISS/HIT pair per origin, with UTC timestamps, so the API's `request_completed` log lines (path, status)
// in the Render dashboard can be matched to exactly one uncached render and one cached hit. Read-only.
// Usage: node call-count-probe.mjs <label=origin>... > out.json
const pairs = process.argv.slice(2).map(a => a.split("="));
const out = [];
for (const [label, origin] of pairs) {
  const url = `${origin}/san-pham/tu-nhua-4-canh-4?callcount=${Date.now().toString(36)}`;
  for (const pass of ["miss", "hit"]) {
    const start = new Date().toISOString(); const t = Date.now();
    const r = await fetch(url); await r.arrayBuffer();
    out.push({ label, pass, start, end: new Date().toISOString(), ms: Date.now() - t, status: r.status, cache: r.headers.get("cf-cache-status"), ray: r.headers.get("cf-ray")?.split("-").pop() });
    await new Promise(res => setTimeout(res, 30000));
  }
  await new Promise(res => setTimeout(res, 30000));
}
console.log(JSON.stringify(out, null, 1));
