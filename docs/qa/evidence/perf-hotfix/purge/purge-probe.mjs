// Authenticated purge probe for the N preview. No content writes: the only state touched is the cache of the
// PREVIEW version and one Supabase Auth session (created by login, revoked at the end). Credentials come from the
// process environment only (run-purge-probe.ps1) and are never printed; tokens are never printed or stored.
// Usage (via the wrapper): node purge-probe.mjs [previewOrigin]
//
// Measurement model (Workers Cache docs, 2026-10-23): tiered by default (lower tier per data centre, upper tier
// consulted on a miss), keyed by path + query + entrypoint + Worker version (no host), tag purges scoped to the
// calling entrypoint and propagated globally. Visitors may land on a different colo for every request, so evidence is
// based on the entry's Age, which travels with the entry through both tiers:
// - "old"   = HIT with Age > (response received - event) + 1 s: created before the event, even if the response was slow.
// - "young" = exactly MISS, or HIT with Age + 1 s <= (request sent - event): created after the event.
//   Any other status (BYPASS, EXPIRED, STALE, UPDATING, missing) is neither and proves nothing.
// - Samples without a colo (no CF-Ray) never count as a same-colo match.
// Gates (per key):
// - purged:   FAIL if any old HIT after the event; PASS if a young response on a colo that served a HIT before the
//             event; otherwise INCONCLUSIVE.
// - survived: PASS if any old HIT after the event (any colo); FAIL if a young response on a colo that served a HIT
//             before the event (within the key's TTL); otherwise INCONCLUSIVE.
// Read-only GETs retry at most 3 times on network errors only; an HTTP status is a result. POST is never retried.
// Sampling is bounded: before the event 1 cold + 6 warm samples per key (to learn the colos the client drifts across),
// after it at most 12 rounds 1.5 s apart, after a 5 s propagation grace. Production samples count only before an absolute
// deadline (warm + 280 s, inside the 300 s TTL). Login/logout/purge: one HTTP attempt, no redirects, 20 s timeout.
// Verdict: PASS / FAIL / INCONCLUSIVE.
import fs from "node:fs";
import path from "node:path";

const PREVIEW = process.argv[2] ?? "https://ace736be-tunhuabinhnham-web.tunhuabinhnham.workers.dev";
const PROD = "https://tunhuabinhnham.com";
const env = Object.fromEntries(fs.readFileSync(process.env.PURGE_ENV_FILE ?? path.resolve(import.meta.dirname, "../../../../../apps/web/.env.production.local"), "utf8")
  .split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const SUPABASE = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const { E2E_ADMIN_EMAIL: email, E2E_ADMIN_PASSWORD: password } = process.env;
if (!SUPABASE || !ANON || !email || !password) { console.log("BLOCKED missing Supabase public config or credentials"); process.exit(2); }

const GRACE_MS = 5000, ROUNDS = 12, SPACING_MS = 1500, PRE_SAMPLES = 6, PROD_TTL_S = 300;
const run = Date.now().toString(36);
const KEYS = {
  previewImage: { url: `${PREVIEW}/_next/image?url=${encodeURIComponent("https://fyaourksnjeldsvuedox.supabase.co/storage/v1/object/public/product-images/2026/10/968783db-9ed3-46ac-ae04-758b0e15a25b.jpg")}&w=384&q=75&purge_probe=${run}`,
    cacheKey: "entrypoint PublicCache, version ace736be, /_next/image?url=…&w=384&q=75&purge_probe=<run>" },
  previewPage: { url: `${PREVIEW}/?purge_probe=${run}`, cacheKey: "entrypoint PublicCache, version ace736be, /?purge_probe=<run>" },
  productionPage: { url: `${PROD}/?purge_isolation_probe=${run}`, cacheKey: "entrypoint PublicCache, version f4fd8f1a, /?purge_isolation_probe=<run>" },
};
const log = []; const checks = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = t => new Date(t).toISOString();

/** GET: up to 3 attempts on network errors only (0.5 s, 1 s). POST: exactly one attempt. Never throws. */
async function request(url, { method = "GET", headers = {} } = {}) {
  const attempts = method === "GET" ? 3 : 1; let error;
  for (let i = 1; i <= attempts; i++) {
    const sent = Date.now();
    try {
      const r = await fetch(url, { method, redirect: "manual", headers: { accept: "image/webp,*/*", ...headers }, signal: AbortSignal.timeout(20000) });
      await r.arrayBuffer();
      // Evidence headers are trusted only in their documented shape; anything else is recorded as null (no evidence).
      const ray = r.headers.get("cf-ray"), age = r.headers.get("age");
      return { status: r.status, cache: r.headers.get("cf-cache-status"), cc: r.headers.get("cache-control"),
        age: age !== null && /^\d{1,9}$/.test(age.trim()) ? Number(age.trim()) : null, ageRaw: age,
        ray, colo: ray && /^[0-9a-f]{16}-[A-Z]{3}$/.test(ray) ? ray.slice(17) : null,
        sent, at: Date.now(), tries: i };
    } catch (e) {
      error = e?.cause?.code ?? e?.name ?? "error"; // never the message
      if (i < attempts) await sleep(500 * i);
    }
  }
  return { status: null, networkError: error, at: Date.now(), tries: attempts };
}
async function sample(key, phase) {
  const r = await request(KEYS[key].url);
  const entry = { key, phase, t: r.at ? iso(r.at) : null, ...r };
  log.push(entry);
  console.log(`  ${phase.padEnd(12)} ${key.padEnd(15)} ${r.status ?? "NET"} ${r.cache ?? "-"} colo=${r.colo ?? "-"} age=${r.age ?? "-"} ray=${r.ray ?? "-"}${r.networkError ? ` ${r.networkError}` : ""}`);
  return entry;
}
const isHit = s => s.status === 200 && s.cache === "HIT";
const old = (s, at) => isHit(s) && s.age !== null && s.age > (s.at - at) / 1000 + 1;
const young = (s, at) => s.status === 200 && (s.cache === "MISS" || (isHit(s) && s.age !== null && s.age + 1 <= (s.sent - at) / 1000));
const hitColos = (key, phases) => new Set(log.filter(s => s.key === key && phases.includes(s.phase) && isHit(s) && s.colo).map(s => s.colo));
const usable = (key, phase, deadline = Infinity) => log.filter(s => s.key === key && s.phase === phase && s.status !== null && s.at <= deadline);

function purgedGate(key, prePhases, postPhase, at) {
  const pre = hitColos(key, prePhases), post = usable(key, postPhase);
  const stale = post.filter(s => old(s, at));
  if (stale.length) return { result: "FAIL", why: `old HIT after event: ${stale.map(s => `${s.colo} age ${s.age}`).join(", ")}` };
  const proof = post.find(s => young(s, at) && s.colo && pre.has(s.colo));
  if (proof) return { result: "PASS", why: `${proof.colo} served HIT before, ${proof.cache} age ${proof.age ?? "-"} after (${proof.t})` };
  return { result: "INCONCLUSIVE", why: `no post-event sample on a pre-event HIT colo (${[...pre].join("/") || "none"}); post colos ${post.map(s => s.colo).join("/") || "none"}` };
}
function survivedGate(key, prePhases, postPhase, at, deadline = Infinity) {
  const pre = hitColos(key, prePhases), post = usable(key, postPhase, deadline);
  const survivor = post.find(s => old(s, at));
  if (survivor) return { result: "PASS", why: `${survivor.colo} HIT age ${survivor.age} > ${((survivor.at - at) / 1000).toFixed(1)} s since event (${survivor.t})` };
  const lost = post.find(s => young(s, at) && s.colo && pre.has(s.colo));
  if (lost) return { result: "FAIL", why: `${lost.colo} served HIT before, ${lost.cache} age ${lost.age ?? "-"} after (${lost.t})` };
  const late = log.filter(s => s.key === key && s.phase === postPhase && s.status !== null && s.at > deadline).length;
  return { result: "INCONCLUSIVE", why: `no old HIT after event; post colos ${post.map(s => s.colo).join("/") || "none"}${late ? `; ${late} sample(s) past the TTL deadline ignored` : ""}` };
}
const gate = (name, g) => { checks.push({ name, ...g }); console.log(`${g.result.padEnd(12)} ${name}: ${g.why}`); return g; };
const statusGate = (name, s, pass) => gate(name, { result: s.status === null ? "INCONCLUSIVE" : pass(s) ? "PASS" : "FAIL", why: `HTTP ${s.status ?? s.networkError} ${s.cc ?? ""} colo=${s.colo ?? "-"}` });

/** Up to `rounds` rounds over `keys`, `spacing` apart, stopping once every gate in `decided()` is decisive. */
async function sampleRounds(keys, phase, decided) {
  for (let i = 0; i < ROUNDS; i++) {
    for (const key of keys) await sample(key, phase);
    if (decided()) return;
    await sleep(SPACING_MS);
  }
}
async function warm(key) { // 1 cold + PRE_SAMPLES warm samples 1 s apart: every colo that serves a HIT joins the pre set
  await sample(key, "cold");
  for (let i = 0; i < PRE_SAMPLES; i++) { await sample(key, "warm"); await sleep(1000); }
}

let token, purgeAt, rejectAt, prodWarmAt, prodDeadline;
const once = (url, init) => fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(20000) }).catch(() => null); // single HTTP attempt
try {
  // Preview keys, then the fail-closed purges: the preview image must survive them.
  await warm("previewImage"); await warm("previewPage");
  await sleep(3000);
  rejectAt = Date.now();
  statusGate("purge without token is refused", await request(`${PREVIEW}/api/revalidate`, { method: "POST" }), s => s.status === 401);
  statusGate("purge with invalid token is refused", await request(`${PREVIEW}/api/revalidate`, { method: "POST", headers: { authorization: "Bearer synthetic.invalid.token" } }), s => s.status === 401);
  await sleep(GRACE_MS);
  const rejectGates = () => ["previewImage", "previewPage"].map(k => survivedGate(k, ["cold", "warm"], "post-reject", rejectAt));
  await sampleRounds(["previewImage", "previewPage"], "post-reject", () => rejectGates().every(g => g.result !== "INCONCLUSIVE"));
  const [rejImg, rejPage] = rejectGates();
  gate("rejected purges evict nothing (preview image survives)", rejImg);
  gate("rejected purges evict nothing (preview page survives)", rejPage);

  // Production key last, so the whole check stays inside its 300 s TTL.
  prodWarmAt = Date.now(); prodDeadline = prodWarmAt + (PROD_TTL_S - 20) * 1000; await warm("productionPage");
  await sleep(3000); // entries must be measurably older than the purge (Age is whole seconds)

  const login = await once(`${SUPABASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  token = login?.ok ? (await login.json()).access_token : undefined;
  gate("admin login", { result: token ? "PASS" : "FAIL", why: `HTTP ${login?.status ?? "network error"}` });

  if (token) {
    const purge = await request(`${PREVIEW}/api/revalidate`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    purgeAt = purge.sent;
    statusGate("authenticated purge succeeds (preview only)", purge, s => s.status === 200 && /no-store/.test(s.cc ?? ""));
    await sleep(GRACE_MS);
    const gates = () => [
      survivedGate("productionPage", ["cold", "warm"], "post-purge", purgeAt, prodDeadline),
      purgedGate("previewImage", ["cold", "warm", "post-reject"], "post-purge", purgeAt),
      purgedGate("previewPage", ["cold", "warm"], "post-purge", purgeAt),
    ];
    await sampleRounds(["productionPage", "previewImage", "previewPage"], "post-purge", () => gates().every(g => g.result !== "INCONCLUSIVE"));
    const [prod, img, page] = gates();
    gate("production cache untouched by the preview purge", prod);
    gate("preview image purged", img);
    gate("preview page purged", page);
  }
} catch (e) {
  gate("unexpected error", { result: "FAIL", why: e?.cause?.code ?? e?.name ?? "error" });
} finally {
  if (token) {
    const out = await once(`${SUPABASE}/auth/v1/logout?scope=local`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${token}` } });
    gate("logout revokes the session", { result: out?.status === 204 ? "PASS" : "FAIL", why: `HTTP ${out?.status ?? "network error"}` });
    statusGate("revoked token cannot purge", await request(`${PREVIEW}/api/revalidate`, { method: "POST", headers: { authorization: `Bearer ${token}` } }), s => s.status === 401 || s.status === 403);
    token = undefined;
  }
  const results = checks.map(c => c.result);
  const verdict = results.includes("FAIL") ? "AUTH_PURGE_PREVIEW_FAIL" : results.includes("INCONCLUSIVE") ? "AUTH_PURGE_PREVIEW_INCONCLUSIVE" : "AUTH_PURGE_PREVIEW_PASS";
  fs.writeFileSync(path.join(process.env.PURGE_OUT_DIR ?? import.meta.dirname, "purge-probe-result.json"), JSON.stringify({
    verdict, run, preview: PREVIEW, production: PROD, rejectAt: rejectAt && iso(rejectAt), purgeAt: purgeAt && iso(purgeAt),
    prodWarmAt: prodWarmAt && iso(prodWarmAt), prodDeadline: prodDeadline && iso(prodDeadline), keys: Object.fromEntries(Object.entries(KEYS).map(([k, v]) => [k, v.cacheKey])),
    checks, samples: log, credentials: "process environment only; no token recorded",
  }, null, 1));
  console.log(verdict);
  process.exitCode = verdict === "AUTH_PURGE_PREVIEW_PASS" ? 0 : verdict === "AUTH_PURGE_PREVIEW_INCONCLUSIVE" ? 3 : 1;
}
