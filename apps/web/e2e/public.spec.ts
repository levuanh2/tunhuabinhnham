import { expect, test } from "@playwright/test";

test("public navigation is usable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Xem sản phẩm" }).click();
  await expect(page).toHaveURL(/san-pham/);
});

test("mobile page does not overflow", async ({ page }) => {
  await page.goto("/");
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
});

// Canonical origin = NEXT_PUBLIC_SITE_URL of the build; set E2E_CANONICAL_ORIGIN when testing a mirror such as workers.dev.
test("canonical, sitemap and robots point at the site origin", async ({ page, request, baseURL }) => {
  const origin = process.env.E2E_CANONICAL_ORIGIN ?? new URL(baseURL!).origin;
  for (const path of ["/", "/san-pham", "/tin-tuc", "/lien-he", "/gioi-thieu"]) {
    await page.goto(path);
    await expect(page.locator('link[rel="canonical"]'), `canonical on ${path}`).toHaveCount(1);
    const canonical = new URL((await page.locator('link[rel="canonical"]').getAttribute("href"))!);
    expect([canonical.origin, canonical.pathname]).toEqual([origin, path]);
  }
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain(`Sitemap: ${origin}/sitemap.xml`);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  expect(locs.length).toBeGreaterThan(0);
  for (const loc of locs) expect(loc.startsWith(origin)).toBe(true);
});
