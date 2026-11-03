// Read-only HTTP smoke for P′ on production. Usage: node pprime-smoke.mjs <origin> <assets dir>... [--out file]
// Network errors (no HTTP response, after 3 tries) are reported as UNVERIFIED, never as PASS or as a site failure.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hashedAssets } from "../../../../../apps/web/scripts/verify-assets-live.mjs";

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out"); const out = outIdx >= 0 ? args.splice(outIdx, 2)[1] : null;
const [origin, ...dirs] = args;
const results = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, headers = {}, method = "GET") {
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(url, { method, headers, redirect: "manual", signal: AbortSignal.timeout(20000) });
      const body = Buffer.from(await r.arrayBuffer());
      return { status: r.status, h: Object.fromEntries(r.headers), body };
    } catch (e) { if (i < 3) await sleep(1000 * i); else return { network: e?.cause?.code ?? e?.name }; }
  }
}
const record = (name, r, pass, detail = {}) => {
  const result = r?.network ? "UNVERIFIED" : pass ? "PASS" : "FAIL";
  results.push({ name, result, status: r?.status, network: r?.network, ...detail });
  console.log(`${result.padEnd(10)} ${name} ${r?.network ?? r?.status ?? ""} ${JSON.stringify(detail)}`);
};

// 1. Asset hashes: every hashed file byte-identical to the archived builds
const files = hashedAssets(dirs); let hashFail = 0, hashUnverified = 0;
for (const file of files) {
  const local = dirs.map(d => path.join(d, file)).find(p => fs.existsSync(p));
  const r = await get(origin + file);
  if (r.network) { hashUnverified++; continue; }
  const same = r.status === 200 && crypto.createHash("sha256").update(r.body).digest("hex") === crypto.createHash("sha256").update(fs.readFileSync(local)).digest("hex");
  if (!same) { hashFail++; console.log(`  hash/status mismatch ${r.status} ${file}`); }
}
record(`asset bytes match archived builds (${files.length})`, hashUnverified === files.length ? { network: "all unreachable" } : { status: 200 }, hashFail === 0 && hashUnverified === 0, { mismatches: hashFail, unverified: hashUnverified });

// 2. Pages, HTML asset set, security headers
const assetSet = b => crypto.createHash("md5").update([...new Set(b.toString().match(/\/_next\/static\/[^"\\ ]+\.(?:js|css)/g) ?? [])].sort().map(l => l + "\n").join("")).digest("hex").slice(0, 8); // = grep | sort -u | md5sum
const P_SET = { "/": "b28565cc", "/san-pham": "d5f68504", "/tin-tuc": "b28565cc", "/lien-he": "b28565cc" }; // measured on P f4fd8f1a
for (const [p, expected] of Object.entries(P_SET)) {
  const r = await get(origin + p, { "user-agent": "Mozilla/5.0 smoke" });
  record(`page ${p} 200, same assets as P`, r, r.status === 200 && assetSet(r.body) === expected, { set: r.body && assetSet(r.body) });
}
const home = await get(origin + "/");
record("security headers", home, ["strict-transport-security", "content-security-policy", "x-content-type-options", "x-frame-options"].every(k => home.h?.[k]), {});
const cat = await get(origin + "/san-pham");
const product = cat.body?.toString().match(/href="(\/san-pham\/[^"?#]+)"/)?.[1];
const pr = product ? await get(origin + product) : { network: "no product link" };
record(`product page ${product}`, pr, pr.status === 200 && /_next\/image/.test(pr.body?.toString() ?? ""), { gallery: (pr.body?.toString().match(/_next\/image/g) ?? []).length });

// 3. Workers Cache HIT/MISS on a unique key, and V1.1 isolation on the same warm key
const key = `${origin}/san-pham?smoke=${Date.now().toString(36)}`;
const cold = await get(key); const warm1 = await get(key); const warm2 = await get(key);
record("anonymous HTML MISS -> HIT", warm2, cold.h?.["cf-cache-status"] !== "HIT" && [warm1, warm2].some(r => r.h?.["cf-cache-status"] === "HIT"),
  { states: [cold, warm1, warm2].map(r => `${r.h?.["cf-cache-status"]}@${(r.h?.["cf-ray"] ?? "").split("-").pop()}`) });
for (const [label, headers] of Object.entries({ cookie: { cookie: "sb-fyaourksnjeldsvuedox-auth-token=probe" }, authorization: { authorization: "Bearer probe" }, both: { cookie: "sb-x-auth-token.0=p", authorization: "Bearer p" } })) {
  const r = await get(key, headers);
  record(`isolation: ${label} never served from cache`, r, r.status === 200 && r.h["cf-cache-status"] !== "HIT" && /^private, no-store/.test(r.h["cache-control"] ?? ""), { cache: r.h?.["cf-cache-status"] ?? null, cc: r.h?.["cache-control"] });
}
for (const p of ["/admin", "/admin/login", "/api/revalidate"]) {
  const r = await get(origin + p);
  record(`private ${p}`, r, /private|no-store/.test(r.h?.["cache-control"] ?? "") && r.h?.["cf-cache-status"] !== "HIT" && r.status < 500, { cc: r.h?.["cache-control"] });
}
const forged = await get(`${origin}/san-pham?_rsc=forged`, { rsc: "1", "next-router-prefetch": "1" });
record("forged RSC private", forged, !/public/.test(forged.h?.["cache-control"] ?? "") && forged.status < 500, { cc: forged.h?.["cache-control"] });
const purge = await get(`${origin}/api/revalidate`, {}, "POST");
record("purge without token refused", purge, purge.status === 401, {});
const img = await get(`${origin}/_next/image?url=${encodeURIComponent("https://fyaourksnjeldsvuedox.supabase.co/storage/v1/object/public/product-images/2026/10/968783db-9ed3-46ac-ae04-758b0e15a25b.jpg")}&w=384&q=75`, { accept: "image/webp" });
record("image optimizer (P behaviour: private, no-store)", img, img.status === 200 && /^image\//.test(img.h["content-type"] ?? ""), { type: img.h?.["content-type"], cc: img.h?.["cache-control"] });
const health = await get("https://tunhuabinhnham-api.onrender.com/health/ready");
record("backend health", health, health.status === 200, {});

const verdict = results.some(r => r.result === "FAIL") ? "SMOKE_FAIL" : results.some(r => r.result === "UNVERIFIED") ? "SMOKE_UNVERIFIED" : "SMOKE_PASS";
if (out) fs.writeFileSync(out, JSON.stringify({ verdict, origin, at: new Date().toISOString(), results }, null, 1));
console.log(verdict);
