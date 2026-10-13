#!/usr/bin/env node
// Version skew guard for Workers rollouts (see docs/deployment/TASK_P1_ASSET_VERSION_SKEW.md).
//
// Next writes content-hashed files under _next/static. Copying the files of neighbouring builds into a
// Worker version's assets lets that version serve CSS/JS referenced by HTML from the version before or
// after it, while Cloudflare is still switching edges between them.
//
//   node scripts/merge-previous-assets.mjs <target .open-next/assets> <source assets dir>...
//
// A source is another build's `.open-next/assets` (or an archive of its `_next/static`). Existing files
// are never overwritten, and only `_next/static/**` is copied (no HTML, no build-id manifests).
import fs from "node:fs";
import path from "node:path";

const [target, ...sources] = process.argv.slice(2);
if (!target || !sources.length) {
  console.error("usage: merge-previous-assets.mjs <target assets dir> <source assets dir>...");
  process.exit(2);
}

const BUILD_ID_DIR = /^_next\/static\/[A-Za-z0-9_-]{16,}\//; // per-build manifests: never referenced across builds
let copied = 0, kept = 0, skipped = 0;
for (const source of sources) {
  const root = path.join(source, "_next", "static");
  if (!fs.existsSync(root)) { console.error(`no _next/static in ${source}`); process.exit(1); }
  for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    const relative = path.relative(source, file).split(path.sep).join("/");
    if (BUILD_ID_DIR.test(relative)) { skipped++; continue; }
    const destination = path.join(target, relative);
    if (fs.existsSync(destination)) { kept++; continue; }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(file, destination);
    copied++;
  }
}
console.log(JSON.stringify({ target, sources: sources.length, copied, alreadyPresent: kept, skippedBuildIdFiles: skipped }));
