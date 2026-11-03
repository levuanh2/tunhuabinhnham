// Read-only HTTP smoke for an RSC V2 PREVIEW version (workers.dev version URL). GETs only, plus one POST to the
// preview's own /api/revalidate without a token (must be 401). Never posts to the production API.
// Usage: node preview-smoke.mjs <preview origin> <api origin> <assets dir> [--out file]
import fs from "node:fs";
import { hashedAssets } from "../../../../../apps/web/scripts/verify-assets-live.mjs";

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out"); const out = outIdx >= 0 ? args.splice(outIdx, 2)[1] : null;
const [origin, api, assetsDir] = args;
const results = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, headers = {}, method = "GET") {
  for (let i = 1; i <= 3; i++) {
    try {
      const t = Date.now();
      const r = await fetch(url, { method, headers, redirect: "manual", signal: AbortSignal.timeout(30000) });
      const body = Buffer.from(await r.arrayBuffer());
      return { status: r.status, h: Object.fromEntries(r.headers), body, ms: Date.now() - t };
    } catch (e) { if (i < 3) await sleep(1000 * i); else return { network: e?.cause?.code ?? e?.name }; }
  }
}
const record = (name, r, pass, detail = {}) => {
  const result = r?.network ? "UNVERIFIED" : pass ? "PASS" : "FAIL";
  results.push({ name, result, status: r?.status, network: r?.network, ...detail });
  console.log(`${result.padEnd(10)} ${name} ${r?.network ?? r?.status ?? ""} ${JSON.stringify(detail)}`);
};
const SECURITY = ["strict-transport-security", "content-security-policy", "x-content-type-options", "x-frame-options"];
const EDGE = "public, max-age=0, s-maxage=300"; // RSC V2 does not change the TTL
const assets = new Set(hashedAssets([assetsDir]));

// 1. Public pages: 200, assets from this build, security headers, edge-cacheable header unchanged
for (const p of ["/", "/san-pham", "/san-pham?category=tu-quan-ao", "/tin-tuc", "/lien-he", "/gioi-thieu"]) {
  const r = await get(origin + p, { "user-agent": "Mozilla/5.0 preview-smoke" });
  const refs = [...new Set(r.body?.toString().match(/\/_next\/static\/[^"\\ ]+\.(?:js|css)/g) ?? [])];
  const foreign = refs.filter(a => !assets.has(a));
  record(`page ${p}`, r, r.status === 200 && refs.length > 0 && foreign.length === 0 && SECURITY.every(k => r.h[k]) && (r.h["cache-control"] === EDGE || /private/.test(r.h["cache-control"] ?? "")),
    { refs: refs.length, foreign: foreign.slice(0, 2), cc: r.h?.["cache-control"], ms: r.ms });
}

// 2. Product page (D): server HTML, canonical, JSON-LD, images; "Sản phẩm cùng loại" iff the API returns `related`
const cat = await get(origin + "/san-pham");
const product = cat.body?.toString().match(/href="(\/san-pham\/[^"?#]+)"/)?.[1];
const pr = product ? await get(origin + product) : { network: "no product link" };
const html = pr.body?.toString() ?? "";
const apiProduct = product ? await get(`${api}/api/v1/products/${product.split("/").pop()}?related=4`) : { network: "no product" };
const apiJson = apiProduct.status === 200 ? JSON.parse(apiProduct.body.toString()) : null;
const backendHasRelated = Array.isArray(apiJson?.related);
const relatedCards = (html.split("Sản phẩm cùng loại")[1]?.match(/href="\/san-pham\/[^"?#]+"/g) ?? []).length;
record(`API ${product}?related=4 (backend ${backendHasRelated ? "with" : "without"} related)`, apiProduct, apiProduct.status === 200 && apiJson?.slug === product?.split("/").pop(),
  { related: backendHasRelated ? apiJson.related.length : "absent (old backend ignores the parameter)" });
record(`product page ${product}`, pr, pr.status === 200 && html.includes(`rel="canonical" href="`) && html.includes("application/ld+json") && /_next\/image/.test(html)
  && (backendHasRelated ? (apiJson.related.length === 0 || relatedCards > 0) : !html.includes("Sản phẩm cùng loại")),
  { relatedSection: html.includes("Sản phẩm cùng loại"), relatedCards, cc: pr.h?.["cache-control"], ms: pr.ms });
if (backendHasRelated) {
  const own = apiJson.related.every(p => p.slug !== apiJson.slug && (!apiJson.category || p.category?.slug === apiJson.category.slug));
  record("related = same category, not itself", apiProduct, own, { n: apiJson.related.length });
}
const posts = await get(origin + "/tin-tuc");
const post = posts.body?.toString().match(/href="(\/tin-tuc\/[^"?#]+)"/)?.[1];
const po = post ? await get(origin + post) : { network: "no post link" };
record(`post page ${post}`, po, po.status === 200, {});

// 3. Workers Cache on the preview: MISS -> HIT; credentials never served from cache; private routes
const key = `${origin}/san-pham?smoke=${Date.now().toString(36)}`;
const cold = await get(key); const warm1 = await get(key); const warm2 = await get(key);
record("anonymous HTML MISS -> HIT", warm2, cold.h?.["cf-cache-status"] !== "HIT" && [warm1, warm2].some(r => r.h?.["cf-cache-status"] === "HIT"),
  { states: [cold, warm1, warm2].map(r => `${r.h?.["cf-cache-status"]}/${r.ms}ms`) });
for (const [label, headers] of Object.entries({ cookie: { cookie: "sb-fyaourksnjeldsvuedox-auth-token=probe" }, authorization: { authorization: "Bearer probe" } })) {
  const r = await get(key, headers);
  record(`isolation: ${label} never served from cache`, r, r.status === 200 && r.h["cf-cache-status"] !== "HIT" && /^private, no-store/.test(r.h["cache-control"] ?? ""), { cache: r.h?.["cf-cache-status"] ?? null, cc: r.h?.["cache-control"] });
}
for (const p of ["/admin", "/admin/login", "/api/revalidate"]) {
  const r = await get(origin + p);
  record(`private ${p}`, r, /private|no-store/.test(r.h?.["cache-control"] ?? "") && r.h?.["cf-cache-status"] !== "HIT" && r.status < 500, { cc: r.h?.["cache-control"] });
}
const purge = await get(`${origin}/api/revalidate`, {}, "POST");
record("purge without token refused", purge, purge.status === 401, {});
const unknown = await get(`${origin}/san-pham/khong-ton-tai-${Date.now().toString(36)}`);
record("unknown product 404, not cached", unknown, unknown.status === 404 && unknown.h["cf-cache-status"] !== "HIT" && !/public/.test(unknown.h["cache-control"] ?? ""), { cc: unknown.h?.["cache-control"] });
const slash = await get(origin + "/san-pham/");
record("trailing slash stays 308", slash, slash.status === 308, { location: slash.h?.location });

// 4. Image cache (24 h, unchanged): first product image through /_next/image, WebP accepted
const img = html.match(/\/_next\/image\?url=[^"&]+&amp;w=\d+&amp;q=\d+/)?.[0]?.replaceAll("&amp;", "&");
const ir = img ? await get(origin + img, { accept: "image/webp,*/*" }) : { network: "no image" };
record("image transform cached 24 h", ir, ir.status === 200 && ir.h["cache-control"] === "public, max-age=3600, s-maxage=86400" && /image\//.test(ir.h["content-type"] ?? ""), { cc: ir.h?.["cache-control"], type: ir.h?.["content-type"] });

const verdict = results.some(r => r.result === "FAIL") ? "SMOKE_FAIL" : results.some(r => r.result === "UNVERIFIED") ? "SMOKE_UNVERIFIED" : "SMOKE_PASS";
if (out) fs.writeFileSync(out, JSON.stringify({ verdict, origin, api, at: new Date().toISOString(), results }, null, 1));
console.log(verdict);
