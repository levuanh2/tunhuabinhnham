// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import next from "@/test/open-next-worker"; // aliased for worker.ts's ./.open-next/worker.js (vitest.config)
import worker, { PublicCache } from "../../worker";

const SRC = "https://fyaourksnjeldsvuedox.supabase.co/storage/v1/object/public/product-images/2026/10/a.jpg";
const imageRequest = (headers: Record<string, string> = { accept: "image/webp,*/*" }, src = SRC) =>
  new Request(`https://tunhuabinhnham.com/_next/image?url=${encodeURIComponent(src)}&w=384&q=75`, { headers });
const webp = (headers: Record<string, string> = {}) => new Response("RIFF", { headers: { "content-type": "image/webp", vary: "Accept", ...headers } });

/** Gateway whose PublicCache binding runs the real entrypoint, so the cached path is exercised end to end. */
function gateway() {
  const cacheFetch = vi.fn((request: Request) => (Reflect.construct(PublicCache, [{}, {}]) as InstanceType<typeof PublicCache>).fetch(request));
  const ctx = { exports: { PublicCache: { fetch: cacheFetch, purge: vi.fn() } } };
  return { fetch: (request: Request) => worker.fetch(request, {}, ctx), cacheFetch };
}

describe("worker /_next/image routing", () => {
  beforeEach(() => { next.fetch.mockReset(); vi.spyOn(console, "warn").mockImplementation(() => {}); });

  it("stores an anonymous WebP image publicly for a bounded time", async () => {
    next.fetch.mockResolvedValue(webp());
    const { fetch, cacheFetch } = gateway();
    const response = await fetch(imageRequest());
    expect(cacheFetch).toHaveBeenCalledOnce();
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600, s-maxage=86400");
  });

  it("never sends a credentialed image request to the cached entrypoint", async () => {
    next.fetch.mockResolvedValue(webp());
    for (const headers of [{ accept: "image/webp", cookie: "sb-x-auth-token=1" }, { accept: "image/webp", authorization: "Bearer t" }] as Record<string, string>[]) {
      const { fetch, cacheFetch } = gateway();
      const response = await fetch(imageRequest(headers));
      expect(cacheFetch).not.toHaveBeenCalled();
      expect(response.headers.get("cache-control")).toMatch(/^private, no-store/);
    }
  });

  it("keeps a 200 with Set-Cookie or a non-image body private", async () => {
    for (const response of [webp({ "set-cookie": "a=1" }), new Response("<html>", { headers: { "content-type": "text/html" } })]) {
      next.fetch.mockResolvedValue(response);
      expect((await gateway().fetch(imageRequest())).headers.get("cache-control")).toMatch(/^private, no-store/);
    }
  });

  it("turns a thrown transform into an uncached redirect to the original upload", async () => {
    next.fetch.mockRejectedValue(new Error("IMAGES_TRANSFORM_ERROR 9523: The operation was aborted due to timeout"));
    const response = await gateway().fetch(imageRequest());
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(SRC);
    expect(response.headers.get("cache-control")).toMatch(/^private, no-store/);
  });

  it("turns a body that fails mid-stream into the same redirect", async () => {
    const body = new ReadableStream({ start(controller) { controller.error(new Error("aborted due to timeout")); } });
    next.fetch.mockResolvedValue(new Response(body, { headers: { "content-type": "image/webp" } }));
    expect((await gateway().fetch(imageRequest())).status).toBe(302);
  });

  it("redirects a 5xx only to a valid source and otherwise keeps it private", async () => {
    next.fetch.mockImplementation(async () => new Response("timed out", { status: 504 }));
    expect((await gateway().fetch(imageRequest())).status).toBe(302);
    const bad = await gateway().fetch(imageRequest({ accept: "image/webp" }, "https://evil.example/a.jpg"));
    expect(bad.status).toBe(504);
    expect(bad.headers.get("location")).toBeNull();
    expect(bad.headers.get("cache-control")).toMatch(/^private, no-store/);
  });

  it("answers HEAD through the cached entrypoint without a body", async () => {
    next.fetch.mockResolvedValue(webp());
    const response = await gateway().fetch(new Request(imageRequest().url, { method: "HEAD", headers: { accept: "image/webp" } }));
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600, s-maxage=86400");
    expect(await response.text()).toBe("");
  });
});
