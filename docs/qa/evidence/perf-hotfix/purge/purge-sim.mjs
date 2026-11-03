// Offline simulator for purge-probe.mjs (loaded with `node --import`): a tiered Workers Cache (per-colo lower tier +
// one shared upper tier), tag purge, Supabase auth. Real time, so Age behaves like Cloudflare's whole seconds.
// SCENARIO: stable | return | continuous | imagesOnly | stale | prodAffected | netflake | netdownProd | netdownAll
//           | malformedAge (Age: Infinity / -5 / empty) | badRay (CF-Ray without a colo) | noHeaders (no Age, no CF-Ray)
// Run: SCENARIO=<s> PURGE_ENV_FILE=<file with NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY>
//      PURGE_OUT_DIR=<dir> E2E_ADMIN_EMAIL=sim E2E_ADMIN_PASSWORD=sim node --import file:///<abs>/purge-sim.mjs purge-probe.mjs
const scenario = process.env.SCENARIO ?? "stable";
const lower = new Map(), upper = new Map(); // key -> created ms; lower key includes colo
let n = 0, revoked = false, purged = false;
const DRIFT = ["HKG", "HKG", "FRA", "MAD", "HKG", "KIX", "FRA", "HKG", "MAD", "MAD", "KIX", "HKG", "FRA"]; // 13: no lockstep with 3 keys
const ray = c => scenario === "noHeaders" ? {} : scenario === "badRay" ? { "cf-ray": "garbage" } : { "cf-ray": `${(++n).toString(16).padStart(16, "0")}-${c}` };
const BAD_AGES = ["Infinity", "-5", ""];
const ageHeader = a => scenario === "noHeaders" ? {} : scenario === "malformedAge" ? { age: BAD_AGES[n % 3] } : { age: String(a) };
function coloFor() {
  if (scenario === "return") return DRIFT[n % DRIFT.length]; // drifts away and comes back, like the 2026-10-23 owner run
  if (scenario === "continuous") return `C${n}`; // never the same colo twice
  return "HKG";
}
const netError = () => { const e = new TypeError("fetch failed"); e.cause = { code: "UND_ERR_CONNECT_TIMEOUT" }; throw e; };
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url); const method = init.method ?? "GET"; const auth = init.headers?.authorization;
  await new Promise(r => setTimeout(r, 30));
  if (u.hostname.endsWith("supabase.co")) {
    if (u.pathname.endsWith("/token")) return Response.json({ access_token: "sim-token" });
    if (u.pathname.endsWith("/logout")) { revoked = true; return new Response(null, { status: 204 }); }
  }
  const colo = coloFor();
  if (u.pathname === "/api/revalidate") {
    if (auth !== "Bearer sim-token" || revoked) return new Response("{}", { status: 401, headers: { "cache-control": "private, no-store", ...ray(colo) } });
    purged = true;
    const hit = k => scenario === "imagesOnly" ? k.includes("_next/image") && k.startsWith("P|") : scenario === "prodAffected" ? true : k.startsWith("P|");
    for (const k of [...lower.keys()]) if (hit(k.slice(k.indexOf("|") + 1))) lower.delete(k); // lower keys: "<colo>|<key>"
    if (scenario !== "stale") for (const k of [...upper.keys()]) if (hit(k)) upper.delete(k); // stale: upper tier keeps the old entry
    return new Response("{}", { status: 200, headers: { "cache-control": "no-store", ...ray(colo) } });
  }
  n++;
  if (scenario === "netflake" && n % 4 === 0) netError(); // every 4th attempt fails; a retry then succeeds
  if (scenario === "netdownProd" && purged && !u.hostname.includes("workers.dev")) netError();
  if (scenario === "netdownAll" && purged) netError(); // every GET after the purge
  const k = `${u.hostname.includes("workers.dev") ? "P" : "PROD"}|${u.pathname}${u.search}`;
  const now = Date.now(); const lk = `${colo}|${k}`;
  const created = lower.get(lk) ?? upper.get(k);
  if (created !== undefined) { lower.set(lk, created); return new Response("x", { status: 200, headers: { "cf-cache-status": "HIT", ...ageHeader(Math.floor((now - created) / 1000)), "cache-control": "public", ...ray(colo) } }); }
  lower.set(lk, now); upper.set(k, now);
  return new Response("x", { status: 200, headers: { "cf-cache-status": "MISS", "cache-control": "public", ...ray(colo) } });
};
