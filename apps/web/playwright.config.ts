import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: { baseURL: externalBaseUrl ?? "http://localhost:3000", trace: "on-first-retry" },
  webServer: externalBaseUrl ? undefined : {
    command: process.env.CI ? "npm run build && npm start" : "npm run dev",
    // ponytail: probe a page that needs no API; "/" now answers 500 when the API is down (error.tsx).
    url: "http://localhost:3000/robots.txt",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"] } },
  ],
});
