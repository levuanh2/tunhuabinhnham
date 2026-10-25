// Network-tolerant soak gate for the P -> P′ -> N rollout. Read-only GETs.
//   node soak-gate.mjs <origin> <assets dir>... [--soak 300] [--timeout 1800] [--out result.json]
// Same pass rule as apps/web/scripts/verify-assets-live.mjs (every hashed _next/static file 200 with the right MIME
// for --soak consecutive seconds), but built for an unreliable client network:
// - requests are serial with a 15 s timeout; a network error (no HTTP response) is retried up to 3 times;
// - an HTTP failure or wrong MIME is an ASSET FAILURE: it resets the soak (the gate's real signal);
// - a file still unreachable after retries makes the round UNVERIFIED: it adds no clean time, but it is not an
//   asset failure. If no clean soak is reached before --timeout, the verdict says which of the two prevented it.
import fs from "node:fs";
import { hashedAssets } from "../../../../../apps/web/scripts/verify-assets-live.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const soak = Number(opt("soak", 300)), timeout = Number(opt("timeout", 1800)), out = opt("out", null);
const [origin, ...dirs] = args;
const EXPECTED = { ".css": /^text\/css/, ".js": /javascript/, ".woff2": /^font\/woff2/, ".woff": /^font\/woff/, ".svg": /^image\/svg\+xml/, ".png": /^image\/png/, ".ico": /^image\/(x-icon|vnd\.microsoft\.icon)/, ".json": /^application\/json/, ".txt": /^text\/plain/ };
const files = hashedAssets(dirs);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(file) {
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(origin + file, { cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(15000) });
      await r.arrayBuffer();
      return { status: r.status, type: r.headers.get("content-type") ?? "", colo: (r.headers.get("cf-ray") ?? "").split("-").pop() };
    } catch (e) { if (i < 3) await sleep(1000 * i); else return { network: e?.cause?.code ?? e?.name ?? "error" }; }
  }
}

const start = Date.now(); let cleanSince = null; const rounds = [];
while ((Date.now() - start) / 1000 < timeout) {
  const t = Date.now(); const failures = [], unverified = []; const colos = new Set();
  for (const file of files) {
    const r = await get(file);
    if (r.network) { unverified.push(`${r.network} ${file}`); continue; }
    colos.add(r.colo);
    const ext = file.slice(file.lastIndexOf("."));
    if (r.status !== 200) failures.push(`${r.status} ${file}`);
    else if (!EXPECTED[ext]?.test(r.type)) failures.push(`MIME ${r.type} ${file}`);
  }
  const state = failures.length ? "ASSET_FAILURE" : unverified.length ? "UNVERIFIED" : "CLEAN";
  if (state === "CLEAN") cleanSince ??= t; else cleanSince = null; // only fully verified rounds count as clean time
  const clean = cleanSince ? (Date.now() - cleanSince) / 1000 : 0;
  rounds.push({ at: new Date(t).toISOString(), state, seconds: Math.round((Date.now() - t) / 1000), colos: [...colos], failures: failures.slice(0, 5), unverified: unverified.length });
  console.log(`${rounds.at(-1).at} ${state} ${files.length - unverified.length}/${files.length} verified, ${failures.length} failing, clean ${Math.round(clean)}s ${failures.slice(0, 2).join(", ")}`);
  if (clean >= soak) break;
  await sleep(5000);
}
const clean = cleanSince ? (Date.now() - cleanSince) / 1000 : 0;
const lastVerified = rounds.filter(r => r.state !== "UNVERIFIED").at(-1);
const verdict = clean >= soak ? "SOAK_PASS" : lastVerified?.state === "ASSET_FAILURE" ? "SOAK_FAIL_ASSETS" : "SOAK_UNVERIFIED_NETWORK";
const result = { verdict, origin, files: files.length, soak, cleanSeconds: Math.round(clean), rounds };
if (out) fs.writeFileSync(out, JSON.stringify(result, null, 1));
console.log(verdict);
process.exitCode = verdict === "SOAK_PASS" ? 0 : 1;
