// Authenticated purge probe for the N preview. No content writes: the only state touched is the cache of the
// PREVIEW version and one Supabase Auth session (created by login, revoked at the end). Credentials come from the
// process environment only (run-purge-probe.ps1) and are never printed; tokens are never printed or stored.
// Usage (via the wrapper): node purge-probe.mjs [previewOrigin]
//
// Evidence rules:
// - Read-only GETs are retried at most 3 times, only on network errors (no HTTP response); an HTTP status is a result.
// - POST (purge, login, logout) is never retried.
// - Edge caches are per data centre (colo, from cf-ray). "MISS after purge" counts only on a colo that served a HIT
//   before the purge; "production untouched" needs a HIT whose Age predates the purge.
// - Any unexpected error is recorded as FAIL, the session is still revoked, and the result file is still written.
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
const sleep = ms => new Promise(r => setTimeout(r, ms));
const record = (step) => { ok &&= step.pass; steps.push(step); console.log(`${step.pass ? "PASS" : "FAIL"} ${step.name} ${step.status ?? "-"} ${step.cache ?? "-"} colo=${step.colo ?? "-"} age=${step.age ?? "-"} tries=${step.tries ?? 1}${step.note ? ` (${step.note})` : ""}`); return step; };

/** One request. GET: up to 3 attempts on network errors only (500 ms, 1000 ms). POST: exactly one attempt. */
async function request(url, { method = "GET", headers = {} } = {}) {
  const attempts = method === "GET" ? 3 : 1; let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      const r = await fetch(url, { method, redirect: "manual", headers: { accept: "image/webp,*/*", ...headers }, signal: AbortSignal.timeout(20000) });
      await r.arrayBuffer();
      return { status: r.status, cache: r.headers.get("cf-cache-status"), cc: r.headers.get("cache-control"), age: r.headers.get("age") === null ? null : Number(r.headers.get("age")),
        colo: (r.headers.get("cf-ray") ?? "").split("-").pop() || null, tries: i, at: Date.now() };
    } catch (error) {
      lastError = `${error?.cause?.code ?? error?.name ?? "error"}`; // never the message: it could echo a URL with a token in other tools
      if (i < attempts) await sleep(500 * i);
    }
  }
  return { status: null, networkError: lastError, tries: attempts, at: Date.now() };
}
const check = async (name, url, expect, init) => {
  const r = await request(url, init);
  if (r.status === null) return record({ name, ...r, pass: false, note: `network error ${r.networkError}, no HTTP response` });
  return record({ name, ...r, pass: expect(r) });
};
/** GET until it lands on one of `colos` (max 4 landings), so a colo switch is never mistaken for a purge. */
async function onColo(name, url, colos, expect) {
  let last;
  for (let i = 1; i <= 4; i++) {
    last = await request(url);
    if (last.status === null) return record({ name, ...last, pass: false, note: `network error ${last.networkError}` });
    if (colos.has(last.colo)) return record({ name, ...last, landings: i, pass: expect(last) });
  }
  return record({ name, ...last, pass: false, note: `never landed on a pre-purge colo ${[...colos].join("/")}` });
}
const hit = r => r.status === 200 && r.cache === "HIT";
const miss = r => r.status === 200 && r.cache !== "HIT";

/** Warm a key: GET (max 4) until two HITs; returns the colos that served a HIT. A colo switch is a MISS, not a failure. */
async function warm(name, url) {
  const colos = new Set(); let hits = 0, last;
  for (let i = 1; i <= 4 && hits < 2; i++) {
    last = await request(url);
    if (last.status === null) return record({ name, ...last, pass: false, note: `network error ${last.networkError}` }), colos;
    if (hit(last)) { hits++; colos.add(last.colo); }
  }
  record({ name, ...last, pass: hits > 0, note: `HIT colos ${[...colos].join("/") || "none"}` });
  return colos;
}
let token, purgeAt;
try {
  await check("preview image cold", IMG, miss);
  const previewImgColos = await warm("preview image warm", IMG);
  await check("preview page cold", PAGE, miss);
  const previewPageColos = await warm("preview page warm", PAGE);
  await check("production page cold (isolation key)", PROD_PAGE, miss);
  const prodColos = await warm("production page warm", PROD_PAGE);
  await sleep(2000); // the production entry must be measurably older than the purge (Age is whole seconds)
  await check("purge without token", `${PREVIEW}/api/revalidate`, r => r.status === 401, { method: "POST" });
  await check("purge with invalid token", `${PREVIEW}/api/revalidate`, r => r.status === 401, { method: "POST", headers: { authorization: "Bearer synthetic.invalid.token" } });
  await onColo("preview image still HIT after rejected purges", IMG, previewImgColos, hit);

  const login = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  token = login.ok ? (await login.json()).access_token : undefined;
  record({ name: "admin login", status: login.status, pass: !!token });

  if (token) {
    const purge = await check("authenticated purge (preview only)", `${PREVIEW}/api/revalidate`, r => r.status === 200 && /no-store/.test(r.cc ?? ""), { method: "POST", headers: { authorization: `Bearer ${token}` } });
    purgeAt = purge.at;
    // Production first: its key expires 300 s after warming. Age must predate the purge.
    await onColo("production page untouched by preview purge", PROD_PAGE, prodColos,
      r => hit(r) && r.age !== null && r.age > (r.at - purgeAt) / 1000); // strict: an entry refilled after the purge is younger
    const purged = await onColo("preview image after purge", IMG, previewImgColos, miss);
    await onColo("preview page after purge", PAGE, previewPageColos, miss);
    // The refill must come from the colo that just answered MISS; other colos were purged too and are still empty.
    await onColo("preview image refill", IMG, new Set([purged.colo]), r => hit(r) && r.age !== null && r.age <= Math.ceil((r.at - purgeAt) / 1000));
  }
} catch (error) {
  record({ name: "unexpected error", pass: false, note: error?.cause?.code ?? error?.name ?? "error" });
} finally {
  if (token) {
    const out = await fetch(`${SUPABASE}/auth/v1/logout?scope=local`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${token}` } }).catch(() => null);
    record({ name: "logout (session revoked)", status: out?.status ?? null, pass: out?.status === 204 });
    await check("purge with revoked token", `${PREVIEW}/api/revalidate`, r => r.status === 401 || r.status === 403, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    token = undefined;
  }
  const verdict = ok ? "AUTH_PURGE_PREVIEW_PASS" : "AUTH_PURGE_PREVIEW_FAIL";
  fs.writeFileSync(path.join(import.meta.dirname, "purge-probe-result.json"),
    JSON.stringify({ verdict, preview: PREVIEW, production: PROD, run, purgeAt, steps, credentials: "process environment only; no token recorded" }, null, 1));
  console.log(verdict);
  process.exitCode = ok ? 0 : 1;
}
