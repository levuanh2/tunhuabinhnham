// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const load = async (supabaseUrl?: string) => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl ?? "");
  return (await import("../../next.config")).default.images?.remotePatterns;
};

describe("next.config image sources", () => {
  afterEach(() => vi.unstubAllEnvs());

  // "**.supabase.co" let anyone run any project's files through our Images quota and edge cache.
  it("allows only this project's public storage", async () => {
    expect(await load("https://fyaourksnjeldsvuedox.supabase.co")).toEqual([
      { protocol: "https", hostname: "fyaourksnjeldsvuedox.supabase.co", pathname: "/storage/v1/object/public/**" },
    ]);
  });

  it("allows no remote images when the build has no Supabase URL", async () => {
    expect(await load()).toEqual([]);
  });
});
