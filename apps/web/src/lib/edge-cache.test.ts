// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { EDGE_CACHE_TAG, edgeCacheHeaders, hasRequestCredentials, imageCacheHeaders, imageFallbackUrl, isEdgeCacheableRequest, isImageRequest, isProductMove, isRscRequest, markRenderDegraded, purgeEdgeCache, renderState } from "./edge-cache";

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
    expect(isEdgeCacheableRequest(req("/?_rsc=abc"))).toBe(false); // _rsc without the RSC header
    for (const name of ["rsc", "next-router-prefetch", "next-router-state-tree", "next-router-segment-prefetch"]) {
      expect(isEdgeCacheableRequest(req("/", { headers: { [name]: "1" } })), name).toBe(false); // router headers without _rsc
    }
    expect(isEdgeCacheableRequest(req("/", { headers: { authorization: "Bearer x" } }))).toBe(false);
    expect(isEdgeCacheableRequest(req("/", { headers: { cookie: "a=1; sb-fyaourksnjeldsvuedox-auth-token=eyJ" } }))).toBe(false);
    expect(isEdgeCacheableRequest(req("/", { headers: { cookie: "sb-x-auth-token.0=chunk" } }))).toBe(false);
    expect(isEdgeCacheableRequest(req("/", { headers: { cookie: "__Host-sb-x-auth-token.1=chunk" } }))).toBe(false);
    expect(isEdgeCacheableRequest(req("/", { headers: { cookie: "__Secure-sb-x-auth-token=token" } }))).toBe(false);
    expect(isEdgeCacheableRequest(req("/", { headers: { cookie: "theme=dark" } }))).toBe(true);
  });

  it("recognizes Authorization and Supabase base, chunked and security-prefixed cookies", () => {
    const credentialHeaders: Record<string, string>[] = [
      { authorization: "Bearer x" },
      { cookie: "sb-project-auth-token=token" },
      { cookie: "a=1; sb-project-auth-token.0=chunk" },
      { cookie: "__Host-sb-project-auth-token.12=chunk" },
      { cookie: "__Secure-sb-project-auth-token=token" },
    ];
    for (const headers of credentialHeaders) expect(hasRequestCredentials(req("/", { headers })), JSON.stringify(headers)).toBe(true);
    for (const cookie of [
      "theme=dark",
      "sb-project-auth-token-extra=value",
      "sb-project-auth-token.01=chunk",
      "prefix-sb-project-auth-token=token",
    ]) expect(hasRequestCredentials(req("/", { headers: { cookie } })), cookie).toBe(false);
  });
});

describe("router (RSC) requests", () => {
  const rscReq = (path: string, headers: Record<string, string> = {}) => req(path, { headers: { rsc: "1", "next-router-prefetch": "1", ...headers } });
  it("are cacheable only for public paths with a signed _rsc and no session", () => {
    expect(isRscRequest(rscReq("/san-pham?_rsc=h1"))).toBe(true);
    expect(isEdgeCacheableRequest(rscReq("/san-pham?_rsc=h1"))).toBe(true);
    expect(isEdgeCacheableRequest(rscReq("/admin/san-pham?_rsc=h1"))).toBe(false);
    expect(isEdgeCacheableRequest(rscReq("/san-pham?_rsc=h1", { cookie: "sb-x-auth-token=1" }))).toBe(false);
    expect(isEdgeCacheableRequest(rscReq("/san-pham?_rsc=h1", { authorization: "Bearer x" }))).toBe(false);
  });
  it("store only text/x-component bodies, never HTML, under the RSC rule", () => {
    const flight = new Response("0:[]", { headers: { "content-type": "text/x-component", vary: "rsc" } });
    expect(edgeCacheHeaders(flight, false, true)?.get("cache-control")).toBe("public, max-age=0");
    // Router payloads are never served stale (they would render without the notice); explicit 0, the default is "forever".
    expect(edgeCacheHeaders(flight, false, true)?.get("cloudflare-cdn-cache-control")).toBe("public, max-age=43200, stale-if-error=0");
    expect(edgeCacheHeaders(html(), false, true)).toBeNull();
    expect(edgeCacheHeaders(flight, false, false)).toBeNull();
    expect(edgeCacheHeaders(flight, true, true)).toBeNull();
  });
});

describe("edgeCacheHeaders", () => {
  it("marks a complete 200 HTML page public with the purge tag and keeps RSC variants apart", () => {
    const headers = edgeCacheHeaders(html(), false)!;
    // 12 h at the edge (owner accepts public content up to ~12 h stale; admin saves still purge the tag), never in browsers.
    // The edge lifetime is only in Cloudflare-CDN-Cache-Control: s-maxage or must-revalidate would disable stale-if-error,
    // and then an expired page plus a Render outage is a 500 for every visitor (2026-11-14).
    expect(headers.get("cache-control")).toBe("public, max-age=0");
    expect(headers.get("cache-control")).not.toMatch(/s-maxage|must-revalidate|proxy-revalidate/);
    expect(headers.get("cloudflare-cdn-cache-control")).toBe("public, max-age=43200, stale-if-error=259200");
    expect(headers.get("cache-tag")).toBe(EDGE_CACHE_TAG);
    expect(headers.get("vary")).toMatch(/rsc/);
    expect(edgeCacheHeaders(html({ headers: { vary: "accept-encoding" } }), false)!.get("vary")).toMatch(/rsc/);
    for (const vary of ["accept-encoding", "rsc", "RSC, Next-Router-State-Tree"]) {
      const got = edgeCacheHeaders(html({ headers: { vary } }), false)!.get("vary")!.toLowerCase();
      for (const name of ["rsc", "next-router-state-tree", "next-router-prefetch", "next-router-segment-prefetch"]) expect(got, `${vary} -> ${name}`).toContain(name);
    }
  });

  it("never caches degraded renders, errors, redirects, Set-Cookie or non-HTML", () => {
    expect(edgeCacheHeaders(html(), true)).toBeNull();
    for (const status of [301, 307, 404, 500]) expect(edgeCacheHeaders(html({ status }), false), String(status)).toBeNull();
    expect(edgeCacheHeaders(html({ headers: { "set-cookie": "sb-x-auth-token=1" } }), false)).toBeNull();
    expect(edgeCacheHeaders(new Response("{}", { headers: { "content-type": "application/json" } }), false)).toBeNull();
  });
});

describe("transformed images (/_next/image)", () => {
  const src = "https://fyaourksnjeldsvuedox.supabase.co/storage/v1/object/public/product-images/2026/10/a.jpg";
  const img = (url = src, headers: Record<string, string> = { accept: "image/avif,image/webp,*/*" }, init: RequestInit = {}) =>
    req(`/_next/image?url=${encodeURIComponent(url)}&w=384&q=75`, { headers, ...init });
  const webp = (init: ResponseInit = {}) => new Response("RIFF", { status: 200, ...init, headers: { "content-type": "image/webp", vary: "Accept", ...init.headers } });

  it("share the edge cache only for anonymous WebP-capable GET/HEAD (the cache key ignores Accept)", () => {
    expect(isImageRequest(img())).toBe(true);
    expect(isEdgeCacheableRequest(img())).toBe(true);
    expect(isEdgeCacheableRequest(img(src, { accept: "image/webp" }, { method: "HEAD" }))).toBe(true);
    expect(isEdgeCacheableRequest(img(src, { accept: "image/png,*/*" }))).toBe(false);
    expect(isEdgeCacheableRequest(img(src, {}))).toBe(false);
    expect(isEdgeCacheableRequest(img(src, { accept: "image/png, image/webp;q=0" }))).toBe(false);
    expect(isEdgeCacheableRequest(img(src, { accept: "image/webp2" }))).toBe(false);
    expect(isEdgeCacheableRequest(img(src, { accept: "image/png, IMAGE/WEBP; q=0.8" }))).toBe(true);
    expect(isEdgeCacheableRequest(img(src, { accept: "image/webp", cookie: "sb-x-auth-token=1" }))).toBe(false);
    expect(isEdgeCacheableRequest(img(src, { accept: "image/webp", authorization: "Bearer x" }))).toBe(false);
    expect(isEdgeCacheableRequest(img(src, { accept: "image/webp" }, { method: "POST" }))).toBe(false);
    expect(isImageRequest(req("/_next/image/x"))).toBe(false);
  });

  it("store only a 200 image, for a bounded time, with the purge tag", () => {
    const headers = imageCacheHeaders(webp())!;
    expect(headers.get("cache-control")).toBe("public, max-age=3600, s-maxage=86400");
    expect(headers.get("cache-tag")).toBe(EDGE_CACHE_TAG);
    expect(headers.get("vary")).toBe("Accept");
    for (const status of [400, 404, 500, 504, 508]) expect(imageCacheHeaders(webp({ status })), String(status)).toBeNull();
    expect(imageCacheHeaders(html())).toBeNull();
    expect(imageCacheHeaders(webp({ headers: { "set-cookie": "a=1" } }))).toBeNull();
  });

  it("fall back only to an https Supabase public-storage upload, never an arbitrary URL", () => {
    expect(imageFallbackUrl(img())).toBe(src);
    for (const url of [
      "https://evil.example/storage/v1/object/public/a.jpg",
      "https://x.supabase.co.evil.example/storage/v1/object/public/a.jpg",
      "http://x.supabase.co/storage/v1/object/public/a.jpg",
      "https://x.supabase.co:8443/storage/v1/object/public/a.jpg",
      "https://user@x.supabase.co/storage/v1/object/public/a.jpg",
      "https://x.supabase.co/storage/v1/object/sign/a.jpg",
      "https://x.supabase.co/storage/v1/object/public/../sign/a.jpg",
      "/_next/static/media/a.png",
      "javascript:alert(1)",
      "",
    ]) expect(imageFallbackUrl(img(url)), url).toBeNull();
    expect(imageFallbackUrl(req("/_next/image?w=384&q=75"))).toBeNull();
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
  it("purges the public tag only when Workers Cache accepts the request", async () => {
    const purge = vi.fn().mockResolvedValue({ success: true });
    expect(await purgeEdgeCache({ cache: { purge } })).toBe(true);
    expect(purge).toHaveBeenCalledWith({ tags: [EDGE_CACHE_TAG] });
    expect(await purgeEdgeCache({})).toBe(false);
    expect(await purgeEdgeCache({ cache: { purge: vi.fn().mockResolvedValue({ success: false }) } })).toBe(false);
    await expect(purgeEdgeCache({ cache: { purge: vi.fn().mockRejectedValue(new Error("rate limited")) } })).rejects.toThrow();
  });
});

describe("public pages are identical for every visitor", () => {
  // The inner cache serves anonymous requests without rendering again, so public pages may not personalise.
  it("no public route or root layout reads cookies, headers, draft mode or the Supabase session", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const files: string[] = [];
    const walk = (dir: string) => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (/\.tsx?$/.test(name)) files.push(path); } };
    walk("src/app/(public)");
    files.push("src/app/layout.tsx", "src/lib/api.ts", "src/lib/brand.ts", "src/components/site-header.tsx", "src/components/site-footer.tsx", "src/components/site-nav.tsx");
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toMatch(/next\/headers|cookies\(|draftMode|@\/lib\/supabase/);
  });

  // Every public route is dynamic, so a viewport prefetch is a full Worker render plus API calls whose result the
  // click never reuses (~22 per page view, the 2026-10-23 slowdown). Links fetch on click only.
  it("no public Link prefetches", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const files: string[] = [];
    const walk = (dir: string) => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (/\.tsx$/.test(name) && !name.startsWith("admin")) files.push(path); } };
    walk("src/app/(public)"); walk("src/components");
    for (const file of files) for (const link of readFileSync(file, "utf8").match(/<Link\b[^>]*/g) ?? []) expect(link, file).toContain("prefetch={false}");
  });
});

describe("isProductMove", () => {
  const moved = (location: string | null, status = 308) => new Response(null, { status, headers: location ? { location } : {} });
  it("is the product page's GET/HEAD redirect from an old URL to the current one", () => {
    expect(isProductMove(req("/san-pham/cu?a=1"), moved("/san-pham/moi?a=1"))).toBe(true);
    expect(isProductMove(req("/san-pham/cu", { method: "HEAD" }), moved("https://tunhuabinhnham.com/san-pham/moi"))).toBe(true);
  });
  it("leaves every other 308 alone, so method-preserving redirects stay 308", () => {
    expect(isProductMove(req("/san-pham/cu", { method: "POST" }), moved("/san-pham/moi"))).toBe(false);
    expect(isProductMove(req("/san-pham/cu/"), moved("/san-pham/cu"))).toBe(false); // trailing-slash redirect
    expect(isProductMove(req("/san-pham/cu"), moved("/san-pham/cu/"))).toBe(false);
    expect(isProductMove(req("/san-pham/cu"), moved("/san-pham/cu"))).toBe(false);
    expect(isProductMove(req("/san-pham/cu"), moved("/tin-tuc/bai"))).toBe(false);
    expect(isProductMove(req("/san-pham/cu"), moved("https://evil.example/san-pham/moi"))).toBe(false);
    expect(isProductMove(req("/san-pham/cu"), moved(null))).toBe(false);
    expect(isProductMove(req("/tin-tuc/cu"), moved("/tin-tuc/moi"))).toBe(false);
    expect(isProductMove(req("/admin/san-pham"), moved("/admin/san-pham/"))).toBe(false);
    for (const status of [301, 302, 307]) expect(isProductMove(req("/san-pham/cu"), moved("/san-pham/moi", status)), String(status)).toBe(false);
  });
});
