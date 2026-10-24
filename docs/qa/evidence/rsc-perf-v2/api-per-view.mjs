// Backend calls per view (cache MISS render) for each route, one at a time against the mock API: what a cache MISS
// costs Render. (A cache HIT is served by the edge without running the Worker's render: 0 calls, except option C's
// browser call, counted by load-mix.mjs.) Usage: node api-per-view.mjs <origin> <label> <out.jsonl> ; env MOCK
import fs from "node:fs";
const [origin, label, out] = process.argv.slice(2), mock = process.env.MOCK ?? "http://127.0.0.1:8790";
const PATHS = ["/san-pham/tu-nhua-4-canh-4", "/san-pham/khong-ton-tai", "/san-pham", "/san-pham?category=tu-4-canh", "/tin-tuc", "/", "/gioi-thieu", "/lien-he"];
const row = { label };
for (const path of PATHS) {
  await fetch(`${mock}/__reset`);
  const res = await fetch(origin + path + (path.includes("?") ? "&" : "?") + "_rsc=x1", { headers: { RSC: "1" } }); await res.text();
  const s = await (await fetch(`${mock}/__stats`)).json();
  row[path] = { status: res.status, calls: s.requests, paths: Object.keys(s.byPath).map(p => p.replace("/api/v1", "")) };
}
fs.appendFileSync(out, JSON.stringify(row) + "\n");
console.log(JSON.stringify(row, null, 1));
