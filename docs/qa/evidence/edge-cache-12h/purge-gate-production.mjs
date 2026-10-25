// Production purge gate for Cache 12H (read-only; no credentials). The owner makes the Admin save in the browser;
// this script only watches the public cache keys before and after it.
//
//   node purge-gate-production.mjs watch <out dir> [minutes=45]
//     Captures real router (RSC) requests from a browser session, then samples every HTML and RSC key every 15 s:
//     status, cf-cache-status, Age, cf-ray location, body hash; saves each body once per new cache entry.
//   node purge-gate-production.mjs evaluate <out dir> <save time ISO> [needle text]
//     Gates per key, around the save time T (from the tail's POST /api/revalidate or the owner's clock):
//     - entry creation time c = response time − Age (HIT) or response time (MISS); Age travels with the entry, so c
//       identifies the entry whatever location answers;
//     - FAIL if a HIT after T + 5 s still has c < T − 1 s (an entry from before the save survived);
//     - PASS if, after T, a response with c ≥ T − 1 s comes from a location that served a HIT before T, and a HIT of
//       that new entry follows (recovery); otherwise INCONCLUSIVE. A MISS on a location that never held the entry, or
//       on a different key, never counts as a purge.
//     - needle: text the owner added; reported per key as absent before T / present after T.
import { chromium } from "playwright";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ORIGIN = "https://tunhuabinhnham.com";
const [mode, dir, a3, a4] = process.argv.slice(2);
const HTML = ["/", "/san-pham", "/san-pham/tu-nhua-4-canh-4", "/tin-tuc", "/gioi-thieu", "/lien-he"];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sample(key) {
  const sent = Date.now();
  try {
    const r = await fetch(ORIGIN + key.path, { headers: key.headers ?? {}, redirect: "manual", signal: AbortSignal.timeout(30000) });
    const body = await r.text();
    const at = Date.now(), age = r.headers.get("age"), ray = r.headers.get("cf-ray") ?? "";
    const ageS = age !== null && /^\d{1,9}$/.test(age.trim()) ? Number(age.trim()) : null;
    const cache = r.headers.get("cf-cache-status");
    return { key: key.id, sent, at, t: new Date(at).toISOString(), status: r.status, cache, age: ageS, colo: /^[0-9a-f]{16}-[A-Z]{3}$/.test(ray) ? ray.slice(17) : null,
      created: cache === "HIT" && ageS !== null ? at - ageS * 1000 : cache === "MISS" ? at : null, cc: r.headers.get("cache-control"), sha: crypto.createHash("sha256").update(body).digest("hex").slice(0, 16), body };
  } catch (e) { return { key: key.id, sent, at: Date.now(), t: new Date().toISOString(), status: null, network: e?.cause?.code ?? e?.name }; }
}

if (mode === "watch") {
  const minutes = Number(a3 ?? 45); fs.mkdirSync(path.join(dir, "bodies"), { recursive: true });
  // Real router requests: navigate like a visitor and keep each page's RSC request (URL + router headers).
  const browser = await chromium.launch(); const page = await browser.newPage(); const rsc = new Map();
  page.on("request", r => { const u = new URL(r.url()); if (u.origin === ORIGIN && u.searchParams.has("_rsc") && !rsc.has(u.pathname)) rsc.set(u.pathname, { path: u.pathname + u.search, headers: Object.fromEntries(Object.entries(r.headers()).filter(([k]) => ["rsc", "next-router-state-tree", "next-url"].includes(k))) }); });
  await page.goto(ORIGIN + "/", { waitUntil: "networkidle" });
  for (const href of ["/san-pham", "/tin-tuc", "/gioi-thieu", "/lien-he"]) { await page.locator(`header a[href="${href}"]`).first().click().catch(() => {}); await page.waitForLoadState("networkidle"); }
  await page.locator('header a[href="/san-pham"]').first().click().catch(() => {}); await page.waitForLoadState("networkidle");
  await page.locator('main a[href="/san-pham/tu-nhua-4-canh-4"]').first().click().catch(() => {}); await page.waitForLoadState("networkidle");
  await page.locator('header a[href="/"]').first().click().catch(() => {}); await page.waitForLoadState("networkidle");
  await browser.close();
  const keys = [...HTML.map(p => ({ id: `html ${p}`, path: p })), ...[...rsc.entries()].map(([p, k]) => ({ id: `rsc ${p}`, ...k }))];
  fs.writeFileSync(path.join(dir, "keys.json"), JSON.stringify(keys.map(k => ({ id: k.id, path: k.path.replace(/_rsc=[^&]+/, "_rsc=…"), routerHeaders: Object.keys(k.headers ?? {}) })), null, 1));
  console.log(`watching ${keys.length} keys (${rsc.size} RSC) for ${minutes} min; make the Admin save now or within the window`);
  const seen = new Map(); const end = Date.now() + minutes * 60000; const out = fs.createWriteStream(path.join(dir, "samples.jsonl"), { flags: "a" });
  while (Date.now() < end) {
    for (const key of keys) {
      const s = await sample(key); const { body, ...row } = s;
      if (body !== undefined && s.created !== null) { const bucket = Math.round(s.created / 5000); const tag = `${key.id}|${bucket}`; if (!seen.has(tag)) { seen.set(tag, true); fs.writeFileSync(path.join(dir, "bodies", `${key.id.replace(/[^a-z0-9]+/gi, "_")}_${new Date(s.created).toISOString().replace(/[:.]/g, "")}.txt`), body); } }
      out.write(JSON.stringify(row) + "\n");
    }
    const last = keys.map(k => k.id); process.stdout.write(`${new Date().toISOString()} round done (${last.length} keys)\n`);
    await sleep(15000);
  }
  out.end(); console.log("WATCH_DONE");
}

if (mode === "evaluate") {
  const T = Date.parse(a3), needle = a4;
  const rows = fs.readFileSync(path.join(dir, "samples.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l)).filter(r => r.status !== null);
  const bodies = fs.readdirSync(path.join(dir, "bodies"));
  const keys = [...new Set(rows.map(r => r.key))]; const result = { saveTime: new Date(T).toISOString(), needle: needle ?? null, keys: {} };
  for (const k of keys) {
    const rs = rows.filter(r => r.key === k);
    const pre = rs.filter(r => r.at < T && r.cache === "HIT" && r.created !== null && r.created < T - 1000);
    const preColos = new Set(pre.map(r => r.colo).filter(Boolean));
    const post = rs.filter(r => r.sent > T);
    const stale = post.filter(r => r.sent > T + 5000 && r.cache === "HIT" && r.created !== null && r.created < T - 1000);
    const young = post.filter(r => r.created !== null && r.created >= T - 1000 && r.colo && preColos.has(r.colo));
    const recovery = young.length ? post.find(r => r.cache === "HIT" && r.created !== null && r.created >= T - 1000 && r.sent > young[0].sent) : null;
    const verdict = stale.length ? "FAIL" : young.length && recovery ? "PASS" : "INCONCLUSIVE";
    const bodyFiles = bodies.filter(f => f.startsWith(k.replace(/[^a-z0-9]+/gi, "_") + "_"));
    const needleIn = needle ? bodyFiles.map(f => ({ file: f, has: fs.readFileSync(path.join(dir, "bodies", f), "utf8").includes(needle) })) : null;
    result.keys[k] = { verdict, preHits: pre.length, preColos: [...preColos], preEntryCreated: pre.length ? new Date(Math.max(...pre.map(r => r.created))).toISOString() : null,
      firstYoung: young[0] ? { t: young[0].t, cache: young[0].cache, age: young[0].age, colo: young[0].colo } : null, recovery: recovery ? { t: recovery.t, age: recovery.age, colo: recovery.colo } : null,
      staleAfterSave: stale.map(r => ({ t: r.t, age: r.age, colo: r.colo })), colosSeen: [...new Set(rs.map(r => r.colo).filter(Boolean))], needle: needleIn };
  }
  const v = Object.values(result.keys).map(x => x.verdict);
  result.verdict = v.includes("FAIL") ? "PRODUCTION_PURGE_FAIL" : v.every(x => x === "PASS") ? "PRODUCTION_PURGE_PASS" : v.some(x => x === "PASS") ? "PRODUCTION_PURGE_PARTIAL" : "PRODUCTION_PURGE_INCONCLUSIVE";
  fs.writeFileSync(path.join(dir, "evaluation.json"), JSON.stringify(result, null, 1)); console.log(JSON.stringify(result, null, 1));
}
