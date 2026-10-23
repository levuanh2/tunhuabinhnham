// Authenticated purge probe for the N preview. No content writes: the only state touched is the cache of the
// PREVIEW version and one Supabase Auth session (created by login, revoked at the end). Credentials come from the
// process environment only (run-purge-probe.ps1) and are never printed; tokens are never printed or stored.
// Usage (via the wrapper): node purge-probe.mjs [previewOrigin]
import fs from "node:fs";
import path from "node:path";

const PREVIEW = process.argv[2] ?? "https://ace736be-tunhuabinhnham-web.tunhuabinhnham.workers.dev";
const PROD = "https://tunhuabinhnham.com";
const env = Object.fromEntries(fs.readFileSync(path.resolve(import.meta.dirname, "../../../../../apps/web/.env.production.local"), "utf8")
  .split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const SUPABASE = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const { E2E_ADMIN_EMAIL: email, E2E_ADMIN_PASSWORD: password } = process.env;
if (!SUPABASE || !ANON || !email || !password) { console.log("BLOCKED missing Supabase public config or credentials"); process.exit(2); }

const run = Date.now().toString(36);
const IMG = `${PREVIEW}/_next/image?url=${encodeURIComponent("https://fyaourksnjeldsvuedox.supabase.co/storage/v1/object/public/product-images/2026/10/968783db-9ed3-46ac-ae04-758b0e15a25b.jpg")}&w=384&q=75&purge_probe=${run}`;
const PAGE = `${PREVIEW}/?purge_probe=${run}`;
const PROD_PAGE = `${PROD}/?purge_isolation_probe=${run}`;
const steps = []; let ok = true;
const snap = async (name, url, expect, init = {}) => {
  const r = await fetch(url, { redirect: "manual", headers: { accept: "image/webp,*/*", ...(init.headers ?? {}) }, method: init.method ?? "GET" });
  await r.arrayBuffer();
  const s = { name, status: r.status, cache: r.headers.get("cf-cache-status"), cc: r.headers.get("cache-control") };
  const pass = expect(s); ok &&= pass; steps.push({ ...s, pass }); console.log(`${pass ? "PASS" : "FAIL"} ${name} ${s.status} ${s.cache ?? "-"} ${s.cc ?? ""}`);
  return s;
};
const isMiss = s => s.status === 200 && s.cache !== "HIT";
const isHit = s => s.status === 200 && s.cache === "HIT";

await snap("preview image cold", IMG, isMiss);
await snap("preview image warm", IMG, isHit);
await snap("preview page cold", PAGE, isMiss);
await snap("preview page warm", PAGE, isHit);
await snap("production page cold (isolation key)", PROD_PAGE, isMiss);
await snap("production page warm (isolation key)", PROD_PAGE, isHit);
await snap("purge without token", `${PREVIEW}/api/revalidate`, s => s.status === 401, { method: "POST" });
await snap("purge with invalid token", `${PREVIEW}/api/revalidate`, s => s.status === 401, { method: "POST", headers: { authorization: "Bearer synthetic.invalid.token" } });
await snap("preview image still HIT after rejected purges", IMG, isHit);

const login = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
const session = login.ok ? await login.json() : null;
const token = session?.access_token;
console.log(`${token ? "PASS" : "FAIL"} admin login ${login.status}`); ok &&= !!token; steps.push({ name: "admin login", status: login.status, pass: !!token });
if (token) {
  try {
    await snap("authenticated purge (preview only)", `${PREVIEW}/api/revalidate`, s => s.status === 200 && /no-store/.test(s.cc ?? ""), { method: "POST", headers: { authorization: `Bearer ${token}` } });
    await snap("preview image after purge", IMG, isMiss);
    await snap("preview image refill", IMG, isHit);
    await snap("preview page after purge", PAGE, isMiss);
    await snap("production page untouched by preview purge", PROD_PAGE, isHit);
  } finally {
    const out = await fetch(`${SUPABASE}/auth/v1/logout?scope=local`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${token}` } });
    const revoked = out.status === 204;
    console.log(`${revoked ? "PASS" : "FAIL"} logout (session revoked) ${out.status}`); ok &&= revoked; steps.push({ name: "logout", status: out.status, pass: revoked });
    await snap("purge with revoked token", `${PREVIEW}/api/revalidate`, s => s.status === 401 || s.status === 403, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  }
}
const verdict = ok ? "AUTH_PURGE_PREVIEW_PASS" : "AUTH_PURGE_PREVIEW_FAIL";
fs.writeFileSync(path.join(import.meta.dirname, `purge-probe-result.json`), JSON.stringify({ verdict, preview: PREVIEW, run, steps, credentials: "process environment only; no token recorded" }, null, 1));
console.log(verdict);
process.exit(ok ? 0 : 1);
