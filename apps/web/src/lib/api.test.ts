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

describe("isUnavailable: backend failure vs a real answer", () => {
  it("treats network errors, 429 and 5xx as unavailable; other 4xx as answers", async () => {
    const { ApiError, isUnavailable } = await import("./api");
    expect(isUnavailable(new TypeError("fetch failed"))).toBe(true);
    expect(isUnavailable(new DOMException("The operation timed out.", "TimeoutError"))).toBe(true);
    for (const status of [429, 500, 503]) expect(isUnavailable(new ApiError(status, "x")), String(status)).toBe(true);
    for (const status of [400, 404, 422]) expect(isUnavailable(new ApiError(status, "x")), String(status)).toBe(false);
  });
});
