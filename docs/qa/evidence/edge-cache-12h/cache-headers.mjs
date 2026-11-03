// Cache policy matrix for the 12 h edge TTL against a TEST origin: local Worker (workerd) + QA fixture API
// (apps/web/e2e/fixtures/mock-api.mjs). Local workerd has no Workers Cache, so this proves the headers each
// response leaves the Worker with (what the cache would store and for how long), not MISS/HIT.
// Usage: node cache-headers.mjs [origin=http://127.0.0.1:8787] [mock=http://127.0.0.1:8100] > out.json
const [origin = "http://127.0.0.1:8787", mock = "http://127.0.0.1:8100"] = process.argv.slice(2);
const EDGE = "public, max-age=0, s-maxage=43200";
const post = (await (await fetch(`${mock}/api/v1/posts`)).json()).items[0].slug;
const rows = [];
async function check(name, path, { headers = {}, expect }) {
  const res = await fetch(origin + path, { headers, redirect: "manual" });
  await res.arrayBuffer();
  const row = { name, path, status: res.status, cacheControl: res.headers.get("cache-control"), cacheTag: res.headers.get("cache-tag"), vary: res.headers.get("vary"), location: res.headers.get("location") };
  row.ok = expect(row);
  rows.push(row);
}
const edge = r => r.status === 200 && r.cacheControl === EDGE && r.cacheTag === "public-html" && /next-router-state-tree/i.test(r.vary ?? "");
const notPublic = r => !/\bpublic\b/.test(r.cacheControl ?? "") && !/s-maxage/.test(r.cacheControl ?? "");

// An RSC request must carry the `_rsc` value Next expects for its router headers; Next 307s to it otherwise.
async function rscPath(path) {
  const res = await fetch(origin + path + (path.includes("?") ? "&" : "?") + "_rsc=x", { headers: { RSC: "1" }, redirect: "manual" });
  await res.arrayBuffer();
  return res.status === 307 ? res.headers.get("location") : null;
}

const PUBLIC = ["/", "/san-pham", "/san-pham?category=tu-giay", "/san-pham?search=t%E1%BB%A7", "/san-pham?page=2", "/san-pham?category=tu-quan-ao&sort=price",
  "/san-pham/tu-giay", "/tin-tuc", `/tin-tuc/${post}`, "/gioi-thieu", "/lien-he"];
for (const path of PUBLIC) await check("HTML public", path, { expect: edge });
for (const path of PUBLIC) {
  const signed = await rscPath(path);
  await check("RSC public (signed _rsc)", signed ?? `${path} (no signed _rsc)`, { headers: { RSC: "1" }, expect: r => edge(r) && signed !== null });
}
// isolation: credentials, admin, API, forged RSC variants
await check("HTML with session cookie", "/san-pham", { headers: { cookie: "sb-abc-auth-token=x" }, expect: notPublic });
await check("HTML with Authorization", "/san-pham", { headers: { authorization: "Bearer x" }, expect: notPublic });
await check("RSC header without _rsc", "/san-pham", { headers: { RSC: "1" }, expect: notPublic });
await check("_rsc without RSC header", "/san-pham?_rsc=abc", { expect: notPublic });
await check("admin", "/admin", { expect: notPublic });
await check("admin login", "/admin/dang-nhap", { expect: notPublic });
await check("API route", "/api/revalidate", { expect: notPublic });
await check("not found product", "/san-pham/khong-ton-tai", { expect: notPublic });
await check("unknown path", "/khong-co-trang-nay", { expect: notPublic });
// sitemap/robots keep Next's own `public, max-age=0, must-revalidate` (not edge-eligible, no s-maxage: never stored)
await check("sitemap", "/sitemap.xml", { expect: r => r.status === 200 && !/s-maxage/.test(r.cacheControl ?? "") });
// old product URL: 301, never stored
await fetch(`${mock}/__reset`, { method: "POST" });
const patched = await fetch(`${mock}/api/v1/admin/products/p3`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "tu-giay-doi-ten" }) });
await check("old product URL", "/san-pham/tu-giay?ref=zalo", { expect: r => patched.ok && r.status === 301 && r.cacheControl === "no-store" && r.location?.endsWith("/san-pham/tu-giay-doi-ten?ref=zalo") });
await fetch(`${mock}/__reset`, { method: "POST" });
// API failure: the degraded render is never public
await fetch(`${mock}/__outage?on=1`, { method: "POST" });
for (const path of ["/", "/san-pham", "/san-pham/tu-giay", "/tin-tuc"]) await check("API outage (degraded)", path, { expect: notPublic });
await fetch(`${mock}/__outage?on=0`, { method: "POST" });
// image transform keeps its own 24 h policy (not changed by this task)
await check("image (no WebP accept)", "/_next/image?url=https%3A%2F%2Fexample.com%2Fa.jpg&w=640&q=75", { expect: r => !/s-maxage=43200/.test(r.cacheControl ?? "") });

const failed = rows.filter(r => !r.ok);
console.log(JSON.stringify({ origin, total: rows.length, failed: failed.length, rows }, null, 1));
process.exitCode = failed.length ? 1 : 0;
