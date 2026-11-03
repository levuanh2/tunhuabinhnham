// Read-only image cache probe for a Worker preview. Usage: node image-cache-probe.mjs <origin> <out-dir>
import crypto from "node:crypto";
import fs from "node:fs";

const [origin, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const SRC = "https://fyaourksnjeldsvuedox.supabase.co/storage/v1/object/public/";
const sources = {
  product: SRC + "product-images/2026/10/968783db-9ed3-46ac-ae04-758b0e15a25b.jpg",
  productLarge: SRC + "product-images/2026/10/87768717-6b51-47bd-a976-e68fcfe2ba04.jpg",
  banner: SRC + "banners/2026/10/d93678b9-b0ae-42b8-bea8-a0b2449ffdb6.png",
  post: SRC + "post-images/2026/10/af404a07-fa79-4b0b-9707-a5bcc64a9e6d.png",
};
const run = Date.now().toString(36); // unique query => guaranteed cold key for this run, without touching real cache keys
const url = (src, w, q = 75, extra = "") => `${origin}/_next/image?url=${encodeURIComponent(src)}&w=${w}&q=${q}${extra}`;
const ACCEPT = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";
const results = []; let failures = 0;
const check = (name, ok, detail) => { results.push({ name, ok, ...detail }); if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`); };
const webpSize = b => { // RIFF WEBP: VP8 / VP8L / VP8X
  const t = b.toString("ascii", 12, 16);
  if (t === "VP8X") return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  if (t === "VP8L") { const v = b.readUInt32LE(21); return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)]; }
  if (t === "VP8 ") return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  return null;
};
async function get(u, headers = { accept: ACCEPT }, method = "GET") {
  const t = Date.now(); const r = await fetch(u, { headers, method, redirect: "manual" });
  const body = method === "HEAD" ? Buffer.alloc(0) : Buffer.from(await r.arrayBuffer());
  return { status: r.status, ms: Date.now() - t, cache: r.headers.get("cf-cache-status"), cc: r.headers.get("cache-control"), type: r.headers.get("content-type"),
    age: r.headers.get("age"), location: r.headers.get("location"), bytes: body.length, sha: crypto.createHash("sha256").update(body).digest("hex").slice(0, 16), size: body.length ? webpSize(body) : null };
}

// 1-2. cold MISS -> warm HIT, identical WebP; per source
for (const [name, src] of Object.entries(sources)) {
  const u = url(src, 640, 75, `&probe=${run}`);
  const cold = await get(u); const warm = await get(u); const warm2 = await get(u);
  check(`${name} cold MISS`, cold.status === 200 && cold.cache !== "HIT", { status: cold.status, cache: cold.cache, ms: cold.ms });
  check(`${name} warm HIT`, warm.cache === "HIT" && warm2.cache === "HIT", { cache: [warm.cache, warm2.cache], ms: [warm.ms, warm2.ms], age: warm2.age });
  check(`${name} same WebP bytes/size`, warm.type === "image/webp" && warm.sha === cold.sha && warm2.sha === cold.sha && warm.size?.[0] <= 640,
    { type: warm.type, bytes: warm.bytes, size: warm.size, sha: [cold.sha, warm.sha] });
  check(`${name} bounded cache-control`, warm.cc === "public, max-age=3600, s-maxage=86400", { cc: warm.cc });
}

// 3. credential bypass after warm: never HIT, never public
const warmUrl = url(sources.product, 640, 75, `&probe=${run}`);
for (const [label, headers] of Object.entries({
  cookie: { accept: ACCEPT, cookie: "sb-fyaourksnjeldsvuedox-auth-token=probe-not-a-real-token" },
  chunkedCookie: { accept: ACCEPT, cookie: "theme=x; sb-fyaourksnjeldsvuedox-auth-token.0=probe" },
  authorization: { accept: ACCEPT, authorization: "Bearer probe-not-a-real-token" },
  both: { accept: ACCEPT, cookie: "sb-fyaourksnjeldsvuedox-auth-token=probe", authorization: "Bearer probe" },
})) {
  const r = await get(warmUrl, headers);
  check(`bypass ${label}`, r.status === 200 && r.cache !== "HIT" && /^private, no-store/.test(r.cc ?? ""), { status: r.status, cache: r.cache, cc: r.cc });
}
// credential-first request must not seed the public cache
const authFirst = url(sources.banner, 384, 75, `&probe=${run}-authfirst`);
await get(authFirst, { accept: ACCEPT, authorization: "Bearer probe" });
const afterAuth = await get(authFirst);
check("auth-first does not seed cache", afterAuth.cache !== "HIT", { cache: afterAuth.cache });

// non-WebP client never shares the cached entry
const png = await get(warmUrl, { accept: "image/png,*/*;q=0.5" });
check("non-WebP client bypass", png.cache !== "HIT" && png.type !== "image/webp" && /^private, no-store/.test(png.cc ?? ""), { cache: png.cache, type: png.type, cc: png.cc });
const q0 = await get(warmUrl, { accept: "image/png, image/webp;q=0" });
// OpenNext itself picks WebP by substring (pre-existing, also live); the cache must just not serve this client.
check("webp;q=0 client bypasses the shared cache", q0.cache !== "HIT" && /^private, no-store/.test(q0.cc ?? ""), { cache: q0.cache, type: q0.type, cc: q0.cc });

// 4. width variants never collide
const widths = {};
for (const w of [384, 640, 1080]) {
  const u = url(sources.productLarge, w, 75, `&probe=${run}-w`);
  await get(u); const r = await get(u); widths[w] = r;
  check(`width ${w} HIT and own size`, r.cache === "HIT" && r.size && r.size[0] <= w, { cache: r.cache, size: r.size, bytes: r.bytes });
}
check("widths distinct", new Set(Object.values(widths).map(r => r.sha)).size === 3, { shas: Object.values(widths).map(r => r.sha) });
const badQ = await get(url(sources.product, 640, 50, `&probe=${run}`));
check("disallowed quality rejected, not cached", badQ.status === 400 && badQ.cache !== "HIT" && !/public/.test(badQ.cc ?? ""), { status: badQ.status, cc: badQ.cc });

// HEAD shares the GET entry
const head = await get(warmUrl, { accept: ACCEPT }, "HEAD");
check("HEAD served from cache, public", head.status === 200 && head.cache === "HIT", { status: head.status, cache: head.cache });

// 5. allowlist and fallback safety
for (const [label, src] of Object.entries({
  otherProject: "https://otherproject.supabase.co/storage/v1/object/public/a/b.jpg",
  signed: "https://fyaourksnjeldsvuedox.supabase.co/storage/v1/object/sign/product-images/x.jpg?token=probe",
  authenticated: "https://fyaourksnjeldsvuedox.supabase.co/storage/v1/object/authenticated/product-images/x.jpg",
  arbitrary: "https://example.com/a.jpg",
  http: "http://fyaourksnjeldsvuedox.supabase.co/storage/v1/object/public/product-images/2026/10/968783db-9ed3-46ac-ae04-758b0e15a25b.jpg",
})) {
  const r = await get(url(src, 640));
  check(`reject ${label}`, r.status === 400 && !r.location && !/public/.test(r.cc ?? ""), { status: r.status, location: r.location, cc: r.cc });
}
const missing = await get(url(SRC + `product-images/2026/10/does-not-exist-${run}.jpg`, 640));
check("missing source: no redirect, not cached", missing.status >= 400 && missing.status < 500 && !missing.location && !/public/.test(missing.cc ?? ""), { status: missing.status, cc: missing.cc });

// 6. private surfaces unchanged
for (const p of ["/admin", "/admin/login", "/api/revalidate"]) {
  const r = await get(origin + p, {});
  check(`private ${p}`, /private|no-store/.test(r.cc ?? "") && r.cache !== "HIT", { status: r.status, cc: r.cc, cache: r.cache });
}
const forged = await get(origin + "/san-pham?_rsc=forged", { rsc: "1", "next-router-prefetch": "1" });
check("forged RSC not public", !/public/.test(forged.cc ?? ""), { status: forged.status, cc: forged.cc });
const purge = await fetch(origin + "/api/revalidate", { method: "POST", headers: { authorization: "Bearer invalid-probe" } });
const still = await get(warmUrl);
check("purge without valid admin is refused and evicts nothing", purge.status === 401 && still.cache === "HIT", { purge: purge.status, after: still.cache });

fs.writeFileSync(`${out}/image-cache-probe.json`, JSON.stringify({ origin, run, failures, results }, null, 1));
console.log(failures ? `IMAGE_CACHE_PROBE_FAIL ${failures}` : "IMAGE_CACHE_PROBE_PASS");
process.exit(failures ? 1 : 0);
