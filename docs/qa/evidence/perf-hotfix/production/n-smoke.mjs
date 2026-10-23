// Read-only HTTP smoke for N on production. Usage: node n-smoke.mjs <origin> <api origin> <N assets dir> [--out file]
// Network errors (no HTTP response after 3 tries) are UNVERIFIED, never PASS or a site failure.
// Writes nothing: the rate-limit check posts contact clicks for a random, non-existent product (422, never stored).
import crypto from "node:crypto";
import fs from "node:fs";
import { hashedAssets } from "../../../../../apps/web/scripts/verify-assets-live.mjs";

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out"); const out = outIdx >= 0 ? args.splice(outIdx, 2)[1] : null;
const [origin, api, nDir] = args;
const results = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, headers = {}, method = "GET", body, retry = true) {
  for (let i = 1; i <= (retry ? 3 : 1); i++) {
    try {
      const r = await fetch(url, { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(20000) });
      return { status: r.status, h: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()) };
    } catch (e) { if (retry && i < 3) await sleep(1000 * i); else return { network: e?.cause?.code ?? e?.name }; }
  }
}
const record = (name, r, pass, detail = {}) => {
  const result = r?.network ? "UNVERIFIED" : pass ? "PASS" : "FAIL";
  results.push({ name, result, status: r?.status, network: r?.network, ...detail });
  console.log(`${result.padEnd(10)} ${name} ${r?.network ?? r?.status ?? ""} ${JSON.stringify(detail)}`);
};
const SECURITY = ["strict-transport-security", "content-security-policy", "x-content-type-options", "x-frame-options"];

// 1. Pages 200, every referenced hashed asset belongs to the N build, security headers
const nAssets = new Set(hashedAssets([nDir]));
for (const p of ["/", "/san-pham", "/san-pham?category=tu-quan-ao", "/tin-tuc", "/lien-he", "/gioi-thieu"]) {
  const r = await get(origin + p, { "user-agent": "Mozilla/5.0 smoke" });
  const refs = [...new Set(r.body?.toString().match(/\/_next\/static\/[^"\\ ]+\.(?:js|css)/g) ?? [])];
  const foreign = refs.filter(a => !nAssets.has(a));
  record(`page ${p} 200, assets from N`, r, r.status === 200 && refs.length > 0 && foreign.length === 0 && SECURITY.every(k => r.h[k]), { refs: refs.length, foreign: foreign.slice(0, 2) });
}
const cat = await get(origin + "/san-pham");
const product = cat.body?.toString().match(/href="(\/san-pham\/[^"?#]+)"/)?.[1];
const pr = product ? await get(origin + product) : { network: "no product link" };
record(`product page ${product}`, pr, pr.status === 200 && /_next\/image/.test(pr.body?.toString() ?? ""), { images: (pr.body?.toString().match(/_next\/image/g) ?? []).length });
const posts = await get(origin + "/tin-tuc");
const post = posts.body?.toString().match(/href="(\/tin-tuc\/[^"?#]+)"/)?.[1];
const po = post ? await get(origin + post) : { network: "no post link" };
record(`post page ${post}`, po, po.status === 200, {});
const hsts = (await get(origin + "/")).h?.["strict-transport-security"] ?? "";
record("HSTS as configured (security-headers.ts, unchanged since e681cca)", { status: 200 }, hsts === "max-age=15552000", { hsts });

// 2. HTML Workers Cache MISS -> HIT and V1.1 isolation on the same warm key
const key = `${origin}/san-pham?smoke=${Date.now().toString(36)}`;
const cold = await get(key); const warm1 = await get(key); const warm2 = await get(key);
record("anonymous HTML MISS -> HIT", warm2, cold.h?.["cf-cache-status"] !== "HIT" && [warm1, warm2].some(r => r.h?.["cf-cache-status"] === "HIT"),
  { states: [cold, warm1, warm2].map(r => `${r.h?.["cf-cache-status"]}@${(r.h?.["cf-ray"] ?? "").split("-").pop()}`) });
for (const [label, headers] of Object.entries({ cookie: { cookie: "sb-fyaourksnjeldsvuedox-auth-token=probe" }, authorization: { authorization: "Bearer probe" }, both: { cookie: "sb-x-auth-token.0=p", authorization: "Bearer p" } })) {
  const r = await get(key, headers);
  record(`isolation: ${label} never served from cache`, r, r.status === 200 && r.h["cf-cache-status"] !== "HIT" && /^private, no-store/.test(r.h["cache-control"] ?? ""), { cache: r.h?.["cf-cache-status"] ?? null, cc: r.h?.["cache-control"] });
}
for (const p of ["/admin", "/admin/login", "/auth/callback", "/api/revalidate"]) {
  const r = await get(origin + p);
  record(`private ${p}`, r, /private|no-store/.test(r.h?.["cache-control"] ?? "") && r.h?.["cf-cache-status"] !== "HIT" && r.status < 500, { cc: r.h?.["cache-control"] });
}
const rscKey = `${origin}/san-pham?category=tu-quan-ao&smoke=${Date.now().toString(36)}`;
const rsc = await get(rscKey, { rsc: "1" });
record("RSC request served, never public", rsc, rsc.status < 500 && !/public/.test(rsc.h?.["cache-control"] ?? "") && rsc.h?.["cf-cache-status"] !== "HIT", { cc: rsc.h?.["cache-control"], type: rsc.h?.["content-type"] });
const purge = await get(`${origin}/api/revalidate`, {}, "POST", undefined, false);
record("purge without token refused", purge, purge.status === 401, {});

// 3. Redirects: www -> apex, http -> https, trailing slash 308 (not turned into 301), unknown product 404 not cached
const www = await get(origin.replace("://", "://www.") + "/san-pham?x=1");
record("www -> apex 301", www, www.status === 301 && www.h.location === `${origin}/san-pham?x=1`, { location: www.h?.location });
const http = await get(origin.replace("https:", "http:") + "/");
record("http -> https 301", http, http.status === 301 && http.h.location?.startsWith("https://"), { location: http.h?.location });
const slash = await get(origin + "/san-pham/");
record("trailing slash stays 308", slash, slash.status === 308, { location: slash.h?.location });
const unknown = await get(`${origin}/san-pham/khong-ton-tai-${Date.now().toString(36)}`);
record("unknown product 404, not cached", unknown, unknown.status === 404 && unknown.h["cf-cache-status"] !== "HIT", { cc: unknown.h?.["cache-control"] });

// 4. Backend: health, security headers, CORS exact, rate limit
for (const p of ["/health/live", "/health/ready"]) { const r = await get(api + p); record(`backend ${p}`, r, r.status === 200, {}); }
const apiRes = await get(`${api}/api/v1/products`, { origin });
record("backend headers + CORS apex", apiRes, apiRes.status === 200 && apiRes.h["access-control-allow-origin"] === origin && SECURITY.every(k => apiRes.h[k]), { acao: apiRes.h?.["access-control-allow-origin"] });
const pre = await get(`${api}/api/v1/products`, { origin, "access-control-request-method": "GET", "access-control-request-headers": "authorization" }, "OPTIONS");
record("CORS preflight apex with Authorization", pre, pre.status === 200 && pre.h["access-control-allow-origin"] === origin && pre.h["access-control-allow-credentials"] === "true" && /authorization/i.test(pre.h["access-control-allow-headers"] ?? ""), {});
const evil = await get(`${api}/api/v1/products`, { origin: "https://evil.example", "access-control-request-method": "GET" }, "OPTIONS");
record("CORS unknown origin refused", evil, evil.status === 400 && !evil.h["access-control-allow-origin"], { acao: evil.h?.["access-control-allow-origin"] ?? null });
// POST is never retried. 10/min per client: unknown product -> 422 until the limit, then 429 with Retry-After and CORS.
const statuses = []; let last;
for (let i = 0; i < 12; i++) {
  last = await get(`${api}/api/v1/contact-clicks`, { origin, "content-type": "application/json" }, "POST", JSON.stringify({ product_id: crypto.randomUUID(), source: "unknown" }), false);
  statuses.push(last.status ?? last.network);
  if (last.status === 429) break;
}
record("contact-click rate limit 422 then 429", last, statuses.slice(0, -1).every(s => s === 422) && last.status === 429 && last.h["retry-after"] && last.h["access-control-allow-origin"] === origin,
  { statuses: statuses.join(","), retryAfter: last.h?.["retry-after"] });

const verdict = results.some(r => r.result === "FAIL") ? "SMOKE_FAIL" : results.some(r => r.result === "UNVERIFIED") ? "SMOKE_UNVERIFIED" : "SMOKE_PASS";
if (out) fs.writeFileSync(out, JSON.stringify({ verdict, origin, api, at: new Date().toISOString(), results }, null, 1));
console.log(verdict);
