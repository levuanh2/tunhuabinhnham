// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupMediaUrls, deleteAdminMedia, uploadAdminMedia } from "./admin-media";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }), signOut: async () => {} } }),
}));

/** Records every request; /api/revalidate answers `purge`. */
function stubFetch(purge = 200) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${input}`);
    if (input === "/api/revalidate") return new Response(null, { status: purge });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return Response.json({ id: "m1", url: "https://x.supabase.co/storage/v1/object/public/b/a.jpg" });
  }));
  return calls;
}

describe("admin media and the public image cache", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("purges the edge cache after a media DELETE, so a removed image stops being served", async () => {
    const calls = stubFetch();
    await deleteAdminMedia({ url: "https://x.supabase.co/storage/v1/object/public/b/a.jpg" });
    expect(calls.at(-1)).toBe("POST /api/revalidate");
    expect(calls[0]).toMatch(/^DELETE .*\/admin\/media\?url=/);
  });

  it("does not purge on upload: a new file is not public until content referencing it is saved", async () => {
    const calls = stubFetch();
    await uploadAdminMedia("product-images", new File(["x"], "a.jpg", { type: "image/jpeg" }));
    expect(calls.some(call => call.endsWith("/api/revalidate"))).toBe(false);
  });

  it("counts a deleted file as cleaned up even when the purge fails (the edge copy expires within a day)", async () => {
    stubFetch(502);
    expect(await cleanupMediaUrls(["https://x.supabase.co/storage/v1/object/public/b/a.jpg"])).toEqual([]);
  });
});
