// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MergeError, mergeAssets } from "./merge-previous-assets.mjs";

const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

/** A fake build: { "chunks/a.css": "body{}" } -> <tmp>/.open-next/assets/_next/static/chunks/a.css */
function build(files, { buildId = "BUILDIDBUILDID1234", extra = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "merge-assets-"));
  dirs.push(root);
  const assets = path.join(root, ".open-next", "assets");
  const write = (relative, content) => { const file = path.join(assets, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
  for (const [relative, content] of Object.entries(files)) write(`_next/static/${relative}`, content);
  write(`_next/static/${buildId}/_buildManifest.js`, `self.__BUILD_MANIFEST=${JSON.stringify(buildId)}`);
  for (const [relative, content] of Object.entries(extra)) write(relative, content);
  return assets;
}
const list = assets => fs.readdirSync(assets, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => path.relative(assets, path.join(e.parentPath, e.name)).split(path.sep).join("/")).sort();
const snapshot = assets => Object.fromEntries(list(assets).map(f => [f, fs.readFileSync(path.join(assets, f), "utf8")]));

describe("mergeAssets", () => {
  it("copies only the other build's hashed _next/static files and is idempotent", () => {
    const previous = build({ "chunks/old.css": "old", "chunks/shared.js": "same" }, { buildId: "PREVIOUSBUILDID123", extra: { "index.html": "<old>", "BUILD_ID": "x" } });
    const next = build({ "chunks/new.css": "new", "chunks/shared.js": "same" }, { buildId: "NEXTBUILDIDNEXT456" });
    expect(mergeAssets({ target: next, sources: [previous] })).toMatchObject({ copied: 1, alreadyPresent: 1, skippedBuildIdFiles: 1 });
    expect(list(next)).toEqual(["_next/static/NEXTBUILDIDNEXT456/_buildManifest.js", "_next/static/chunks/new.css", "_next/static/chunks/old.css", "_next/static/chunks/shared.js"]);
    const before = snapshot(next);
    expect(mergeAssets({ target: next, sources: [previous] })).toMatchObject({ copied: 0, alreadyPresent: 2 });
    expect(snapshot(next)).toEqual(before); // second run changes nothing
    expect(fs.readFileSync(path.join(previous, "index.html"), "utf8")).toBe("<old>"); // sources untouched
  });

  it("aborts without writing when the same path has different content", () => {
    const previous = build({ "chunks/a.css": "AAA", "chunks/b.css": "only-old" });
    const next = build({ "chunks/a.css": "BBB" });
    const before = snapshot(next);
    expect(() => mergeAssets({ target: next, sources: [previous] })).toThrow(/same path, different content.*chunks\/a\.css/);
    expect(snapshot(next)).toEqual(before); // b.css was not copied either: all checks run before any write
  });

  it("detects collisions between two sources too", () => {
    const one = build({ "chunks/x.js": "1" }), two = build({ "chunks/x.js": "2" }), next = build({ "chunks/n.js": "n" });
    expect(() => mergeAssets({ target: next, sources: [one, two] })).toThrow(MergeError);
    expect(list(next)).not.toContain("_next/static/chunks/x.js");
  });

  it("keeps several previous builds (retention) and stays within the Cloudflare limits", () => {
    const releases = [build({ "chunks/r1.js": "1" }), build({ "chunks/r2.js": "2" }), build({ "chunks/r3.js": "3" })];
    const next = build({ "chunks/n.js": "n" });
    expect(mergeAssets({ target: next, sources: releases })).toMatchObject({ copied: 3 });
    expect(() => mergeAssets({ target: next, sources: [build({ "chunks/big.js": "x".repeat(11) })], limits: { maxFiles: 20_000, maxFileBytes: 10 } })).toThrow(/over 10 bytes/);
    expect(() => mergeAssets({ target: next, sources: [build({ "chunks/more.js": "m" })], limits: { maxFiles: 5, maxFileBytes: 1e9 } })).toThrow(/over the 5 limit/);
    // An oversized file produced by the target build itself is reported too, also in a dry run.
    const bigTarget = build({ "chunks/huge.js": "y".repeat(11) });
    expect(() => mergeAssets({ target: bigTarget, sources: [build({ "chunks/ok.js": "o" })], dryRun: true, limits: { maxFiles: 20_000, maxFileBytes: 10 } })).toThrow(/huge\.js/);
    expect(list(next)).not.toContain("_next/static/chunks/more.js");
  });

  it("only touches build artifacts", () => {
    const next = build({ "chunks/n.js": "n" });
    const notABuild = fs.mkdtempSync(path.join(os.tmpdir(), "merge-assets-src-")); dirs.push(notABuild);
    fs.mkdirSync(path.join(notABuild, "_next", "static"), { recursive: true });
    expect(() => mergeAssets({ target: notABuild, sources: [next] })).toThrow(/must be a \.open-next\/assets/);
    expect(() => mergeAssets({ target: next, sources: [path.join(notABuild, "missing")] })).toThrow(/no _next\/static/);
  });

  it("dry run plans without writing; the CLI exits 1 and writes nothing on a collision", () => {
    const previous = build({ "chunks/p.js": "p" }), next = build({ "chunks/n.js": "n" });
    expect(mergeAssets({ target: next, sources: [previous], dryRun: true })).toMatchObject({ planned: 1, copied: 0 });
    expect(list(next)).not.toContain("_next/static/chunks/p.js");
    const clash = build({ "chunks/n.js": "different" });
    const script = path.join(import.meta.dirname, "merge-previous-assets.mjs");
    let status = 0;
    try { execFileSync(process.execPath, [script, next, clash], { stdio: "pipe" }); } catch (error) { status = error.status; }
    expect(status).toBe(1);
    expect(fs.readFileSync(path.join(next, "_next/static/chunks/n.js"), "utf8")).toBe("n");
  });
});
