import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.E2E_BASE_URL;
// CI tests the real runtime: the OpenNext Worker (worker.ts adds security and edge-cache headers) under
// `wrangler dev` on :8787. Locally `next dev` on :3000 stays the default; set E2E_BASE_URL for anything else.
const local = process.env.CI ? "http://localhost:8787" : "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // Specs share one in-memory fixture API and several reset or mutate it, so CI runs them one at a time.
  workers: process.env.CI ? 1 : undefined,
  use: { baseURL: externalBaseUrl ?? local, trace: "on-first-retry" },
  webServer: externalBaseUrl ? undefined : [
    // E2E_MOCK_API=1: Playwright starts the QA fixture API (never Supabase/Render), waits for it and stops it after
    // the run. The Next build must point at it: NEXT_PUBLIC_API_URL=http://127.0.0.1:8100/api/v1 etc. (see ci.yml).
    ...(process.env.E2E_MOCK_API === "1" ? [{
      command: "node e2e/fixtures/mock-api.mjs",
      url: "http://127.0.0.1:8100/api/v1/site-settings",
      reuseExistingServer: !process.env.CI,
    }] : []),
    {
      command: process.env.CI ? "npm run preview:cloudflare" : "npm run dev",
      // ponytail: probe a page that needs no API; "/" answers 500 when the API is down (error.tsx).
      url: `${local}/robots.txt`,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000, // CI runs the OpenNext build first
    },
  ],
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"] } },
  ],
});
