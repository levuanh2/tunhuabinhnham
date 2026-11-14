import { expect, test } from "@playwright/test";

/* Final V1 blocker fixes: security headers (V1-SEC-04), Vietnamese 404 (V1-UX-01). Read-only. */

const mock = process.env.E2E_MOCK_API_URL ?? "http://127.0.0.1:8100";

test("H1. pages, admin, 404s and API routes carry the security headers", async ({ request }) => {
  for (const path of ["/", "/san-pham", "/admin/login", "/khong-co-trang-nay", "/api/revalidate"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    const headers = response.headers();
    expect(headers["content-security-policy"], path).toContain("frame-ancestors 'none'");
    expect(headers["x-frame-options"], path).toBe("DENY");
    expect(headers["x-content-type-options"], path).toBe("nosniff");
    expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"], path).toContain("camera=()");
    expect(headers["x-powered-by"], path).toBeUndefined();
  }
  // V1-CACHE-01: a response without Cache-Control is never stored.
  // /api/ is a sensitive path: worker.ts forces "private, no-store, max-age=0" there since e681cca.
  expect((await request.get("/api/revalidate")).headers()["cache-control"]).toBe("private, no-store, max-age=0");
});

test("H2. static assets are served with nosniff and their immutable cache header", async ({ page, request }) => {
  await page.goto("/");
  const asset = await page.locator('script[src*="/_next/static/"]').first().getAttribute("src");
  const headers = (await request.get(asset!)).headers();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["cache-control"]).toContain("immutable");
});

test("H3. admin cannot be framed by another origin; the site still hydrates", async ({ page, baseURL }) => {
  await page.goto(`${mock}/health`);
  await page.setContent(`<iframe src="${baseURL}/admin/login" width="800" height="600"></iframe>`);
  await page.waitForTimeout(2000);
  await expect(page.frameLocator("iframe").getByLabel("Email")).toHaveCount(0);
  // Same page opened directly works and is interactive (hydrated).
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill("qa@example.test");
  await page.getByLabel("Mật khẩu").fill("wrong-password-1");
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.locator("p[role=alert]")).toBeVisible();
});

for (const path of ["/khong-co-trang-nay", "/san-pham/khong-co-san-pham-nay", "/tin-tuc/khong-co-bai-nay"]) {
  test(`N1. ${path} is a real 404 in Vietnamese, with the site header, footer and a way back`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response!.status()).toBe(404);
    expect(response!.headers()["cache-control"] ?? "").not.toContain("public");
    await expect(page.getByRole("heading", { level: 1, name: "Không tìm thấy trang" })).toBeVisible();
    await expect(page).toHaveTitle(/^Không tìm thấy/); // product/article 404s name what is missing
    // Every robots tag says noindex (product/article pages add their own next to Next's not-found one).
    const robots = await page.locator('meta[name="robots"]').evaluateAll(tags => tags.map(tag => tag.getAttribute("content")));
    expect(robots.length).toBeGreaterThan(0);
    for (const content of robots) expect(content).toContain("noindex");
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
    await expect(page.locator("#noi-dung")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.getByRole("main").getByRole("link", { name: "Xem sản phẩm" }).click();
    await expect(page).toHaveURL(/\/san-pham$/);
  });
}
