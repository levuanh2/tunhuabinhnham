// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { EDGE_CACHE_TAG, edgeCacheHeaders, isEdgeCacheableRequest, markRenderDegraded, purgeEdgeCache, renderState } from "./edge-cache";

const req = (path: string, init: RequestInit = {}) => new Request(`https://tunhuabinhnham.com${path}`, init);
const html = (init: ResponseInit = {}) => new Response("<html></html>", { status: 200, ...init, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", vary: "rsc, next-router-state-tree", ...init.headers } });

describe("isEdgeCacheableRequest", () => {
  it("accepts anonymous GET/HEAD for public pages, including query strings", () => {
    for (const path of ["/", "/san-pham", "/san-pham?category=do-dung", "/san-pham/tu-5-tang", "/tin-tuc", "/tin-tuc/bai-viet", "/lien-he", "/gioi-thieu"]) {
      expect(isEdgeCacheableRequest(req(path)), path).toBe(true);
    }
    expect(isEdgeCacheableRequest(req("/", { method: "HEAD" }))).toBe(true);
  });

  it("rejects admin, API, auth, assets and unknown paths", () => {
    for (const path of ["/admin", "/admin/", "/admin/login", "/admin/san-pham", "/api/revalidate", "/api/auth/logout", "/auth/callback", "/_next/image", "/sitemap.xml", "/san-pham/a/b", "/SAN-PHAM"]) {
      expect(isEdgeCacheableRequest(req(path)), path).toBe(false);
    }
  });

  it("rejects non-GET, RSC/prefetch, Authorization and Supabase session cookies", () => {
    expect(isEdgeCacheableRequest(req("/", { method: "POST" }))).toBe(false);
    expect(isEdgeCacheableRequest(req("/?_rsc=abc"))).toBe(false);
    for (const name of ["rsc", "next-router-prefetch", "next-router-state-tree", "next-router-segment-prefetch"]) {
      expect(isEdgeCacheableRequest(req("/", { headers: { [name]: "1" } })), name).toBe(false);
    }
    expect(isEdgeCacheableRequest(req("/", { headers: { authorization: "Bearer x" } }))).toBe(false);
    expect(isEdgeCacheableRequest(req("/", { headers: { cookie: "a=1; sb-fyaourksnjeldsvuedox-auth-token=eyJ" } }))).toBe(false);
    expect(isEdgeCacheableRequest(req("/", { headers: { cookie: "sb-x-auth-token.0=chunk" } }))).toBe(false);
    expect(isEdgeCacheableRequest(req("/", { headers: { cookie: "theme=dark" } }))).toBe(true);
  });
});

describe("edgeCacheHeaders", () => {
  it("marks a complete 200 HTML page public with the purge tag and keeps RSC variants apart", () => {
    const headers = edgeCacheHeaders(html(), false)!;
    expect(headers.get("cache-control")).toBe("public, max-age=0, s-maxage=300");
    expect(headers.get("cache-tag")).toBe(EDGE_CACHE_TAG);
    expect(headers.get("vary")).toMatch(/rsc/);
    expect(edgeCacheHeaders(html({ headers: { vary: "accept-encoding" } }), false)!.get("vary")).toMatch(/rsc/);
  });

  it("never caches degraded renders, errors, redirects, Set-Cookie or non-HTML", () => {
    expect(edgeCacheHeaders(html(), true)).toBeNull();
    for (const status of [301, 307, 404, 500]) expect(edgeCacheHeaders(html({ status }), false), String(status)).toBeNull();
    expect(edgeCacheHeaders(html({ headers: { "set-cookie": "sb-x-auth-token=1" } }), false)).toBeNull();
    expect(edgeCacheHeaders(new Response("{}", { headers: { "content-type": "application/json" } }), false)).toBeNull();
  });
});

describe("render state", () => {
  it("records a fallback only for the render it happened in", async () => {
    const a = { degraded: false }, b = { degraded: false };
    await Promise.all([
      renderState.run(a, async () => { await Promise.resolve(); markRenderDegraded(); }),
      renderState.run(b, async () => { await Promise.resolve(); }),
    ]);
    expect([a.degraded, b.degraded]).toEqual([true, false]);
    expect(() => markRenderDegraded()).not.toThrow(); // outside a cached render: no-op
  });
});

describe("purgeEdgeCache", () => {
  it("purges the public tag when the Worker exposes ctx.cache, and is a no-op otherwise", async () => {
    const purge = vi.fn().mockResolvedValue(undefined);
    expect(await purgeEdgeCache({ cache: { purge } })).toBe(true);
    expect(purge).toHaveBeenCalledWith({ tags: [EDGE_CACHE_TAG] });
    expect(await purgeEdgeCache({})).toBe(false);
    await expect(purgeEdgeCache({ cache: { purge: vi.fn().mockRejectedValue(new Error("rate limited")) } })).rejects.toThrow();
  });
});
