// Propagation gate for the two-step rollout (docs/deployment/TASK_P1_ASSET_VERSION_SKEW.md).
//
//   node scripts/verify-assets-live.mjs <origin> <assets dir>... [--soak 300] [--interval 10] [--timeout 1800]
//
// Requests every hashed `_next/static` file of the given builds from <origin> (the apex) in rounds.
// Passes only after `--soak` seconds of CONSECUTIVE clean rounds: every file 200 with the right MIME type.
// Any failure resets the soak; no clean soak before `--timeout` fails (exit 1). Read-only: GET requests only.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUILD_ID_DIR = /^_next\/static\/[A-Za-z0-9_-]{16,}\//;
const EXPECTED_TYPE = { ".css": /^text\/css/, ".js": /javascript/ };

export function hashedAssets(dirs) {
  const files = new Set();
  for (const dir of dirs) {
    const root = path.join(dir, "_next", "static");
    if (!fs.existsSync(root)) throw new Error(`no _next/static in ${dir}`);
    for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const relative = path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/");
      if (!BUILD_ID_DIR.test(relative)) files.add(`/${relative}`);
    }
  }
  return [...files].sort();
}

async function checkRound(origin, files) {
  const failures = [];
  await Promise.all(files.map(async file => {
    try {
      const response = await fetch(origin + file, { cache: "no-store", redirect: "manual" });
      await response.arrayBuffer();
      const expected = EXPECTED_TYPE[path.extname(file)];
      const type = response.headers.get("content-type") ?? "";
      if (response.status !== 200) failures.push(`${response.status} ${file}`);
      else if (expected && !expected.test(type)) failures.push(`MIME ${type} ${file}`);
    } catch (error) { failures.push(`${error.name} ${file}`); }
  }));
  return failures;
}

export async function verifyAssetsLive({ origin, dirs, soakSeconds = 300, intervalSeconds = 10, timeoutSeconds = 1800, log = console.log }) {
  const files = hashedAssets(dirs);
  const started = Date.now();
  let cleanSince = null, rounds = 0, failedRounds = 0;
  while ((Date.now() - started) / 1000 < timeoutSeconds) {
    const failures = await checkRound(origin, files);
    rounds++;
    if (failures.length) { failedRounds++; cleanSince = null; log(`round ${rounds}: ${failures.length} failing, soak reset: ${failures.slice(0, 3).join(", ")}`); }
    else {
      cleanSince ??= Date.now();
      const clean = (Date.now() - cleanSince) / 1000;
      if (clean >= soakSeconds) return { ok: true, files: files.length, rounds, failedRounds, cleanSeconds: Math.round(clean) };
    }
    await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
  }
  return { ok: false, files: files.length, rounds, failedRounds, reason: `no ${soakSeconds}s clean soak within ${timeoutSeconds}s` };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2), option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? Number(args.splice(i, 2)[1]) : fallback; };
  const soakSeconds = option("--soak", 300), intervalSeconds = option("--interval", 10), timeoutSeconds = option("--timeout", 1800);
  const [origin, ...dirs] = args;
  if (!origin || !dirs.length) { console.error("usage: verify-assets-live.mjs <origin> <assets dir>... [--soak s] [--interval s] [--timeout s]"); process.exit(2); }
  const result = await verifyAssetsLive({ origin, dirs, soakSeconds, intervalSeconds, timeoutSeconds });
  console.log(JSON.stringify(result));
  process.exit(result.ok ? 0 : 1);
}
