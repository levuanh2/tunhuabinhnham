// Version skew guard for Workers rollouts (see docs/deployment/TASK_P1_ASSET_VERSION_SKEW.md).
//
// Next writes content-hashed files under _next/static. Copying the files of neighbouring builds into a
// Worker version's assets lets that version serve CSS/JS referenced by HTML from the version before or
// after it, while Cloudflare is still switching edges between them.
//
//   node scripts/merge-previous-assets.mjs [--dry-run] <target .open-next/assets> <source assets dir>...
//
// A source is another build's `.open-next/assets` (or an archive holding its `_next/static`).
// Safety rules, all checked before anything is written:
// - only build artifacts: the target must be a `.open-next/assets` dir; target and sources must contain _next/static;
// - only `_next/static/**` is copied (no HTML, no route files); per-build manifests under the build-id dir are skipped;
// - a file that already exists is never overwritten; same path with different bytes (SHA-256) aborts the merge;
// - the result must stay within the Cloudflare static assets limits (20,000 files / version on Free, 25 MiB / file).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LIMITS = { maxFiles: 20_000, maxFileBytes: 25 * 1024 * 1024 };
const BUILD_ID_DIR = /^_next\/static\/[A-Za-z0-9_-]{16,}\//; // per-build manifests: never referenced across builds

const sha256 = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const filesUnder = dir => fs.readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile()).map(entry => path.join(entry.parentPath, entry.name));

export class MergeError extends Error {}

/** Plans and (unless dryRun) applies the merge. Throws MergeError without writing anything on any violation. */
export function mergeAssets({ target, sources, dryRun = false, limits = LIMITS }) {
  if (path.basename(target) !== "assets" || path.basename(path.dirname(target)) !== ".open-next") throw new MergeError(`target must be a .open-next/assets build directory: ${target}`);
  for (const dir of [target, ...sources]) if (!fs.existsSync(path.join(dir, "_next", "static"))) throw new MergeError(`no _next/static in ${dir}`);

  const plan = new Map(); // relative path -> source file
  const collisions = [], oversize = [];
  let alreadyPresent = 0, skippedBuildIdFiles = 0;
  for (const source of sources) {
    for (const file of filesUnder(path.join(source, "_next", "static"))) {
      const relative = path.relative(source, file).split(path.sep).join("/");
      if (BUILD_ID_DIR.test(relative)) { skippedBuildIdFiles++; continue; }
      if (fs.statSync(file).size > limits.maxFileBytes) oversize.push(relative);
      const existing = fs.existsSync(path.join(target, relative)) ? path.join(target, relative) : plan.get(relative);
      if (!existing) { plan.set(relative, file); continue; }
      if (sha256(existing) !== sha256(file)) collisions.push(relative);
      else if (!plan.has(relative)) alreadyPresent++;
    }
  }
  if (collisions.length) throw new MergeError(`same path, different content (not a hashed asset?): ${collisions.slice(0, 5).join(", ")}${collisions.length > 5 ? ` (+${collisions.length - 5})` : ""}`);
  if (oversize.length) throw new MergeError(`files over ${limits.maxFileBytes} bytes: ${oversize.slice(0, 5).join(", ")}`);
  const totalFiles = filesUnder(target).length + plan.size;
  if (totalFiles > limits.maxFiles) throw new MergeError(`merged version would have ${totalFiles} files, over the ${limits.maxFiles} limit`);

  if (!dryRun) for (const [relative, file] of plan) {
    const destination = path.join(target, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(file, destination, fs.constants.COPYFILE_EXCL); // EXCL: never overwrite, even on a race
  }
  return { target, sources: sources.length, copied: dryRun ? 0 : plan.size, planned: plan.size, alreadyPresent, skippedBuildIdFiles, totalFiles, dryRun };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const [target, ...sources] = args.filter(arg => arg !== "--dry-run");
  if (!target || !sources.length) { console.error("usage: merge-previous-assets.mjs [--dry-run] <target .open-next/assets> <source assets dir>..."); process.exit(2); }
  try { console.log(JSON.stringify(mergeAssets({ target: path.resolve(target), sources: sources.map(s => path.resolve(s)), dryRun }))); }
  catch (error) { if (error instanceof MergeError) { console.error(`merge aborted, nothing written: ${error.message}`); process.exit(1); } throw error; }
}
