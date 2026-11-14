// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api";
import { renderState } from "./edge-cache";

const render = async (response: () => Promise<Response>) => {
  vi.stubGlobal("fetch", vi.fn(response));
  const state = { degraded: false };
  await renderState.run(state, () => apiFetch("/site-settings").catch(() => null));
  return state.degraded;
};

describe("apiFetch marks fallback renders so they are never edge-cached", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("stays clean on a good response", async () => {
    expect(await render(async () => Response.json({ store_name: "x" }))).toBe(false);
  });
  it("marks network errors, any non-OK status (404 included) and unreadable JSON", async () => {
    expect(await render(async () => { throw new TypeError("fetch failed"); })).toBe(true);
    for (const status of [404, 429, 500, 503]) expect(await render(async () => new Response("{}", { status })), String(status)).toBe(true);
    expect(await render(async () => new Response("{truncated", { headers: { "content-type": "application/json" } }))).toBe(true);
  });
});

describe("apiFetch ends hung requests and logs upstream failures without private data", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  const hang = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))));
  const logged = (warn: { mock: { calls: unknown[][] } }): Record<string, unknown>[] => warn.mock.calls.map(call => JSON.parse(String(call[0])));

  it("aborts a request that never answers after API_TIMEOUT_MS, as an unavailable backend", async () => {
    vi.stubEnv("API_TIMEOUT_MS", "50");
    vi.stubGlobal("fetch", hang);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { isUnavailable } = await import("./api");
    const state = { degraded: false };
    const error = await renderState.run(state, () => apiFetch("/products?search=ten khach").catch((e: unknown) => e));
    expect((error as Error).name).toBe("TimeoutError");
    expect(isUnavailable(error)).toBe(true);
    expect(state.degraded).toBe(true);
    expect(logged(warn)).toEqual([expect.objectContaining({ event: "api_upstream_error", path: "/products", category: "timeout" })]);
  });

  it("defaults to a timeout long enough for a Render cold start", async () => {
    const seen: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { seen.push(init.signal!); return Response.json({}); }));
    await apiFetch("/site-settings");
    expect(seen[0]).toBeInstanceOf(AbortSignal);
    expect(seen[0].aborted).toBe(false);
  });

  it("categorises 429, 5xx, network and bad JSON, keeps Render's request id and never logs the query or body", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const answers: (() => Promise<Response>)[] = [
      async () => new Response("Too Many Requests", { status: 429, headers: { "content-type": "text/plain", "rndr-id": "abc-123" } }),
      async () => new Response("{}", { status: 503 }),
      async () => { throw new TypeError("fetch failed"); },
      async () => new Response("{truncated", { headers: { "content-type": "application/json" } }),
      async () => new Response("{}", { status: 404 }), // a real answer: not an upstream failure, not logged
    ];
    for (const answer of answers) { vi.stubGlobal("fetch", vi.fn(answer)); await apiFetch("/products?search=0901234567").catch(() => null); }
    const lines = logged(warn);
    expect(lines.map(line => [line.category, line.status])).toEqual([["rate_limited", 429], ["upstream_5xx", 503], ["network", undefined], ["invalid_json", 200]]);
    expect(lines[0].rndrId).toBe("abc-123");
    expect(JSON.stringify(lines)).not.toMatch(/0901234567|search|Too Many/);
  });

  it("recovers on the next request once the API answers again", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    await expect(apiFetch("/products")).rejects.toThrow();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ items: [{ slug: "tu-5-tang" }] })));
    await expect(apiFetch("/products")).resolves.toEqual({ items: [{ slug: "tu-5-tang" }] });
  });
});

describe("apiFetch tells the Worker when the API could not answer (router requests then become a 500)", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  const run = async (answer: () => Promise<Response>) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(answer));
    const state: { degraded: boolean; unavailable?: boolean } = { degraded: false };
    await renderState.run(state, () => apiFetch("/products").catch(() => null));
    return state;
  };
  it("marks 429, 5xx, network errors and unreadable bodies unavailable; a 404 only degraded", async () => {
    for (const status of [429, 500, 503]) expect(await run(async () => new Response("x", { status })), String(status)).toEqual({ degraded: true, unavailable: true });
    expect(await run(async () => { throw new TypeError("fetch failed"); })).toEqual({ degraded: true, unavailable: true });
    expect(await run(async () => new Response("{truncated"))).toEqual({ degraded: true, unavailable: true });
    expect(await run(async () => new Response("{}", { status: 404 }))).toEqual({ degraded: true });
    expect(await run(async () => Response.json({ items: [] }))).toEqual({ degraded: false });
  });
});

describe("isUnavailable: backend failure vs a real answer", () => {
  it("treats network errors, 429 and 5xx as unavailable; other 4xx as answers", async () => {
    const { ApiError, isUnavailable } = await import("./api");
    expect(isUnavailable(new TypeError("fetch failed"))).toBe(true);
    expect(isUnavailable(new DOMException("The operation timed out.", "TimeoutError"))).toBe(true);
    for (const status of [429, 500, 503]) expect(isUnavailable(new ApiError(status, "x")), String(status)).toBe(true);
    for (const status of [400, 404, 422]) expect(isUnavailable(new ApiError(status, "x")), String(status)).toBe(false);
  });
});
