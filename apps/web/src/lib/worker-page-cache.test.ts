// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import next from "@/test/open-next-worker"; // aliased for worker.ts's ./.open-next/worker.js (vitest.config)
import worker, { PublicCache } from "../../worker";
import { STALE_NOTICE, markRenderDegraded } from "./edge-cache";

/* Page responses through the real gateway + PublicCache entrypoint. Workers Cache prefers Cloudflare-CDN-Cache-Control
   over Cache-Control, so that header decides what the edge stores and for how long it may serve it stale on errors. */
const CDN = "cloudflare-cdn-cache-control";
const html = (status = 200, headers: Record<string, string> = {}) =>
  new Response("<html></html>", { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });
const page = (path = "/", headers: Record<string, string> = {}) => new Request(`https://tunhuabinhnham.com${path}`, { headers });

function gateway() {
  const cacheFetch = vi.fn((request: Request) => (Reflect.construct(PublicCache, [{}, {}]) as InstanceType<typeof PublicCache>).fetch(request));
  const ctx = { exports: { PublicCache: { fetch: cacheFetch, purge: vi.fn() } } };
  return (request: Request) => worker.fetch(request, {}, ctx);
}

describe("public page edge caching", () => {
  beforeEach(() => next.fetch.mockReset());

  it("stores a complete anonymous page 12 h at the edge and lets the edge serve it stale only on Worker errors", async () => {
    next.fetch.mockResolvedValue(html());
    const response = await gateway()(page("/san-pham"));
    expect(response.headers.get("cache-control")).toBe("public, max-age=0");
    expect(response.headers.get(CDN)).toBe("public, max-age=43200, stale-if-error=259200");
    expect(response.headers.get("cache-tag")).toBe("public-html");
  });

  it("never stores the error page (API 429/5xx/timeout renders error.tsx as 500)", async () => {
    next.fetch.mockResolvedValue(html(500));
    const response = await gateway()(page("/"));
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get(CDN)).toBeNull();
    expect(response.headers.get("cache-tag")).toBeNull();
  });

  it("never stores a 200 page rendered from fallback data", async () => {
    next.fetch.mockImplementation(async () => { markRenderDegraded(); return html(); });
    const response = await gateway()(page("/"));
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get(CDN)).toBeNull();
  });

  it("strips edge cache headers from every private response, whoever set them", async () => {
    const stray = { [CDN]: "public, max-age=43200", "cdn-cache-control": "max-age=60" };
    for (const request of [page("/", { cookie: "sb-x-auth-token=1" }), page("/", { authorization: "Bearer t" }), page("/admin/san-pham"), page("/api/revalidate")]) {
      next.fetch.mockResolvedValue(html(200, stray));
      const response = await gateway()(request);
      expect(response.headers.get("cache-control"), request.url).toBe("private, no-store, max-age=0");
      expect(response.headers.get(CDN), request.url).toBeNull();
      expect(response.headers.get("cdn-cache-control"), request.url).toBeNull();
    }
  });
});

describe("stale-if-error notice", () => {
  // Minimal stand-in for the Workers HTMLRewriter: prepends to <body> in the text.
  class FakeRewriter {
    private content = "";
    on(_selector: string, handler: { element(element: { prepend(content: string): void }): void }) { handler.element({ prepend: content => { this.content = content; } }); return this; }
    // Async here; the gateway returns it from an async handler, so the promise is flattened like a Response.
    async transform(response: Response) { return new Response((await response.text()).replace("<body>", `<body>${this.content}`), response); }
  }
  const cached = (response: Response) => {
    const ctx = { exports: { PublicCache: { fetch: vi.fn(async () => response), purge: vi.fn() } } };
    return worker.fetch(page("/san-pham"), {}, ctx);
  };
  beforeEach(() => vi.stubGlobal("HTMLRewriter", FakeRewriter));
  afterEach(() => vi.unstubAllGlobals());

  it("tells visitors a page served stale (Render down) may be out of date", async () => {
    const response = await cached(new Response("<html><body><main>x</main></body></html>", { headers: { "content-type": "text/html", "cf-cache-status": "STALE" } }));
    const text = await response.text();
    expect(text).toContain(STALE_NOTICE);
    expect(text).toMatch(/<body><p role="status"[^>]*>Thông tin có thể chưa được cập nhật mới nhất/);
  });

  it("leaves fresh hits, misses and stale RSC payloads untouched", async () => {
    for (const [status, type] of [["HIT", "text/html"], ["MISS", "text/html"], ["STALE", "text/x-component"]]) {
      const body = "<html><body><main>x</main></body></html>";
      const response = await cached(new Response(body, { headers: { "content-type": type, "cf-cache-status": status } }));
      expect(await response.text(), `${status} ${type}`).toBe(body);
    }
  });
});

it("the Worker entry module exports only handlers (workerd refuses to start on any other export)", async () => {
  expect(Object.keys(await import("../../worker")).sort()).toEqual(["PublicCache", "default"]);
});
