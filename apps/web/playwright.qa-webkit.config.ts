// QA-only config (Final V1 audit): runs the whole suite, including desktop-only fixture-writing specs,
// in desktop WebKit (Safari engine) and desktop Chromium. The project names stay "desktop" because the
// specs gate fixture writes on that name. Not used by CI.
import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  webServer: undefined,
  projects: [{ name: "desktop", use: { ...devices["Desktop Safari"] } }],
});
