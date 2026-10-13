// @vitest-environment node
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashedAssets, verifyAssetsLive } from "./verify-assets-live.mjs";

const cleanup = [];
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn(); });

function assetsDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-assets-"));
  cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const relative of files) { const file = path.join(dir, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "x"); }
  return dir;
}
/** Serves `available()` paths with a proper MIME type, 404 (text/html) otherwise: like a Worker version. */
async function server(available) {
  const s = http.createServer((req, res) => {
    const ok = available().has(req.url);
    const type = req.url.endsWith(".css") ? "text/css" : req.url.endsWith(".woff2") ? "font/woff2" : "application/javascript";
    res.writeHead(ok ? 200 : 404, { "content-type": ok ? type : "text/html" });
    res.end(ok ? "x" : "<h1>404</h1>");
  });
  await new Promise(resolve => s.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise(resolve => s.close(resolve)));
  return `http://127.0.0.1:${s.address().port}`;
}
const quiet = () => {};

describe("verifyAssetsLive", () => {
  it("lists hashed files only", () => {
    const dir = assetsDir(["_next/static/chunks/a.css", "_next/static/chunks/b.js", "_next/static/BUILDIDBUILDID12345/_buildManifest.js", "index.html"]);
    expect(hashedAssets([dir])).toEqual(["/_next/static/chunks/a.css", "/_next/static/chunks/b.js"]);
  });

  it("passes after a contiguous clean soak", async () => {
    const dir = assetsDir(["_next/static/chunks/a.css", "_next/static/chunks/b.js"]);
    const origin = await server(() => new Set(["/_next/static/chunks/a.css", "/_next/static/chunks/b.js"]));
    const result = await verifyAssetsLive({ origin, dirs: [dir], soakSeconds: 0.3, intervalSeconds: 0.1, timeoutSeconds: 5, log: quiet });
    expect(result).toMatchObject({ ok: true, files: 2, failedRounds: 0 });
  });

  it("resets the soak on a 404 during propagation, then passes once clean", async () => {
    const dir = assetsDir(["_next/static/chunks/new.css"]);
    let round = 0;
    const origin = await server(() => (++round <= 2 ? new Set() : new Set(["/_next/static/chunks/new.css"]))); // old edges first
    const result = await verifyAssetsLive({ origin, dirs: [dir], soakSeconds: 0.3, intervalSeconds: 0.1, timeoutSeconds: 5, log: quiet });
    expect(result.ok).toBe(true);
    expect(result.failedRounds).toBe(2);
  });

  it("checks the MIME type of every extension (fonts too) and fails unknown extensions", async () => {
    const font = assetsDir(["_next/static/media/a.woff2"]);
    const fine = await server(() => new Set(["/_next/static/media/a.woff2"]));
    expect(await verifyAssetsLive({ origin: fine, dirs: [font], soakSeconds: 0.2, intervalSeconds: 0.1, timeoutSeconds: 3, log: quiet })).toMatchObject({ ok: true });
    const htmlForEverything = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<h1>fallback</h1>"); });
    await new Promise(resolve => htmlForEverything.listen(0, "127.0.0.1", resolve));
    cleanup.push(() => new Promise(resolve => htmlForEverything.close(resolve)));
    const htmlOrigin = `http://127.0.0.1:${htmlForEverything.address().port}`;
    const logs = [];
    expect(await verifyAssetsLive({ origin: htmlOrigin, dirs: [font], soakSeconds: 0.2, intervalSeconds: 0.1, timeoutSeconds: 0.5, log: line => logs.push(line) })).toMatchObject({ ok: false });
    expect(logs.join(" ")).toMatch(/MIME text\/html \/_next\/static\/media\/a\.woff2/); // 200 text/html is not a font
    const odd = assetsDir(["_next/static/media/x.unknownext"]);
    const oddOrigin = await server(() => new Set(["/_next/static/media/x.unknownext"]));
    const oddLogs = [];
    expect(await verifyAssetsLive({ origin: oddOrigin, dirs: [odd], soakSeconds: 0.2, intervalSeconds: 0.1, timeoutSeconds: 0.5, log: line => oddLogs.push(line) })).toMatchObject({ ok: false });
    expect(oddLogs.join(" ")).toMatch(/unknown extension/);
  });

  it("fails when an asset keeps failing or has the wrong MIME type", async () => {
    const dir = assetsDir(["_next/static/chunks/gone.css"]);
    const origin = await server(() => new Set());
    expect(await verifyAssetsLive({ origin, dirs: [dir], soakSeconds: 0.2, intervalSeconds: 0.1, timeoutSeconds: 0.6, log: quiet })).toMatchObject({ ok: false });
    const wrongType = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<h1>not css</h1>"); });
    await new Promise(resolve => wrongType.listen(0, "127.0.0.1", resolve));
    cleanup.push(() => new Promise(resolve => wrongType.close(resolve)));
    const result = await verifyAssetsLive({ origin: `http://127.0.0.1:${wrongType.address().port}`, dirs: [dir], soakSeconds: 0.2, intervalSeconds: 0.1, timeoutSeconds: 0.6, log: quiet });
    expect(result).toMatchObject({ ok: false });
  });
});
