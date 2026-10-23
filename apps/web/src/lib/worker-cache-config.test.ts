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
    expect(source).toContain('if (!await purgeEdgeCache(this.ctx)) throw new Error("Workers Cache API unavailable")');
    expect(source).toContain("cacheHeaders ? finalHeaders(cacheHeaders) : finalHeaders(response.headers, true)");
    expect(gateway).toContain('request.method === "POST" && url.pathname === "/api/revalidate"');
    expect(gateway).toContain("if (!response.ok) return response");
    expect(gateway).toContain("await ctx.exports.PublicCache.purge()");
    expect(gateway.indexOf('url.pathname === "/api/revalidate"')).toBeLessThan(gateway.indexOf("if (hasRequestCredentials(request))"));
  });

  it("sends images to the cached entrypoint only through the credential-checking rule, with a fallback", () => {
    const source = readWorkerSource();
    const image = source.slice(source.indexOf("async function fetchImage"), source.indexOf("/** Only this inner entrypoint"));
    expect(image).toContain("isEdgeCacheableRequest(request) ? ctx.exports.PublicCache.fetch(request) : fetchPrivate(request, env, ctx)");
    expect(image).toContain("imageFallbackUrl(request)");
    expect(source).toContain("isImageRequest(request) ? imageCacheHeaders(response)");
    expect(source).toContain("return fetchPublic(request, this.env, this.ctx).catch(");
    expect(source.slice(source.indexOf("const worker ="))).toContain("if (isImageRequest(request)) return fetchImage(request, env, ctx)");
  });
});
