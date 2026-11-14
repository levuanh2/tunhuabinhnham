// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

type CacheConfig = {
  cache?: { enabled?: boolean };
  exports?: Record<string, { cache?: { enabled?: boolean } }>;
};

function readWranglerConfig(): CacheConfig {
  const source = readFileSync("wrangler.jsonc", "utf8").replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(source) as CacheConfig;
}

function readWorkerSource(): string {
  return readFileSync("worker.ts", "utf8");
}

describe("Workers Cache entrypoint isolation", () => {
  it("keeps the request-inspecting gateway uncached and caches only the inner public entrypoint", () => {
    const config = readWranglerConfig();
    expect(config.cache?.enabled).toBe(false);
    expect(config.exports?.default?.cache?.enabled).toBe(false);
    expect(config.exports?.PublicCache?.cache?.enabled).toBe(true);
  });

  it("purges through the cache-owning entrypoint after a successful revalidation", () => {
    const source = readWorkerSource();
    const gateway = source.slice(source.indexOf("const worker ="));
    expect(source).toContain("async purge(): Promise<void>");
    // Fails closed: the only silent skip is the local e2e preview (var set AND no ctx.cache); otherwise purge throws.
    const purge = source.slice(source.indexOf("async purge(): Promise<void>"), source.indexOf("const worker ="));
    expect(purge).toContain("if (await purgeEdgeCache(this.ctx)) return;");
    expect(purge).toContain('E2E_LOCAL_NO_EDGE_CACHE === "1"');
    expect(purge).toContain("if (localOnly && !(this.ctx as { cache?: unknown } | undefined)?.cache) return;");
    expect(purge).toMatch(/\?\.cache\) return;\s*throw new Error\("Workers Cache API unavailable"\);\s*\}/);
    expect(source).toContain("cacheHeaders ? finalHeaders(cacheHeaders) : finalHeaders(response.headers, true)");
    expect(gateway).toContain('request.method === "POST" && url.pathname === "/api/revalidate"');
    expect(gateway).toContain("if (!response.ok) return response");
    expect(gateway).toContain("await ctx.exports.PublicCache.purge()");
    expect(gateway.indexOf('url.pathname === "/api/revalidate"')).toBeLessThan(gateway.indexOf("if (hasRequestCredentials(request))"));
  });

});
