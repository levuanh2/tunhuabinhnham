import { expect, test, type Page } from "@playwright/test";
import { gotoReady } from "./hydration";

/*
 * V1.1: a published product's URL can change; the old URL answers 301 to the current one.
 * Runs ONLY against the local QA fixture server (e2e/fixtures/mock-api.mjs), which mirrors the API's
 * product_slugs history and its 301. Writes run on the desktop project only and reset the fixture.
 */
test.skip(process.env.E2E_MOCK_API !== "1", "Requires the local QA fixture API (E2E_MOCK_API=1)");

const mock = process.env.E2E_MOCK_API_URL ?? "http://127.0.0.1:8100";
const writesFixture = () => test.skip(test.info().project.name !== "desktop", "mutates shared fixture state; run once");

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill("qa@example.test");
  await page.getByLabel("Mật khẩu").fill("qa-password-123");
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL(/\/admin\/?$/, { timeout: 30_000 });
}

async function startEditingUrl(page: Page, slug: string) {
  await gotoReady(page, "/admin/san-pham/p2");
  await page.getByRole("button", { name: "Chỉnh sửa đường dẫn" }).click();
  await page.getByLabel("Đường dẫn sản phẩm").fill(slug);
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
}

const redirectOf = async (page: Page, path: string) => {
  const response = await page.request.get(path, { maxRedirects: 0 });
  return [response.status(), response.headers().location ?? null, response.headers()["cache-control"] ?? null];
};

test.describe("product URL change", () => {
  test.beforeEach(async ({ page }) => { await page.request.post(`${mock}/__reset`); await login(page); });

  test("S1. confirm, save, stay on the form; the old URL redirects once, with its query, and SEO points at the new one", async ({ page }) => {
    writesFixture();
    await gotoReady(page, "/admin/san-pham/p2");
    await page.getByLabel("Giá bán (VNĐ)").fill("3500000");
    await page.getByRole("button", { name: "Chỉnh sửa đường dẫn" }).click();
    await expect(page.getByText("Khách mở đường dẫn cũ sẽ được tự động chuyển sang đường dẫn mới.")).toBeVisible();
    await page.getByLabel("Đường dẫn sản phẩm").fill("tu-ao-3-canh-guong");
    await page.getByRole("button", { name: "Lưu thay đổi" }).click();

    const dialog = page.getByRole("dialog", { name: "Đổi đường dẫn sản phẩm?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("/san-pham/tu-ao-3-canh");
    await expect(dialog).toContainText("/san-pham/tu-ao-3-canh-guong");
    await expect(dialog).toContainText("http://localhost:8787/san-pham/tu-ao-3-canh-guong");
    await expect(dialog).toContainText("sẽ được tự động chuyển sang đường dẫn mới");
    await dialog.getByRole("button", { name: "Quay lại" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByLabel("Đường dẫn sản phẩm")).toHaveValue("tu-ao-3-canh-guong"); // nothing typed is lost
    expect((await (await page.request.get(`${mock}/api/v1/admin/products/p2`)).json()).slug).toBe("tu-ao-3-canh");

    await page.getByRole("button", { name: "Lưu thay đổi" }).click();
    await dialog.getByRole("button", { name: "Đổi đường dẫn và lưu" }).click();
    const done = page.getByRole("status").filter({ hasText: "Đã đổi đường dẫn" });
    await expect(done).toContainText("Khách mở /san-pham/tu-ao-3-canh sẽ được tự động chuyển sang /san-pham/tu-ao-3-canh-guong.");
    await expect(done.getByRole("link", { name: /Mở trang sản phẩm/ })).toHaveAttribute("href", "/san-pham/tu-ao-3-canh-guong");
    await expect(page).toHaveURL(/\/admin\/san-pham\/p2$/);
    await expect(page.locator("output")).toHaveText("/san-pham/tu-ao-3-canh-guong");
    await expect(page.getByLabel("Giá bán (VNĐ)")).toHaveValue("3500000");
    const saved = await (await page.request.get(`${mock}/api/v1/admin/products/p2`)).json();
    expect([saved.slug, saved.sku, Number(saved.price), saved.images.length]).toEqual(["tu-ao-3-canh-guong", "TA-3C-02", 3500000, 3]);

    // Old URL: one 301 straight to the current URL, query kept, never cached.
    expect(await redirectOf(page, "/san-pham/tu-ao-3-canh?utm_source=zalo&a=1&a=2")).toEqual([301, "/san-pham/tu-ao-3-canh-guong?utm_source=zalo&a=1&a=2", "no-store"]);
    const landed = await page.goto("/san-pham/tu-ao-3-canh?utm_source=zalo");
    expect(landed?.status()).toBe(200);
    await expect(page).toHaveURL(/\/san-pham\/tu-ao-3-canh-guong\?utm_source=zalo$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tủ áo 3 cánh có gương");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/san-pham\/tu-ao-3-canh-guong$/);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", /\/san-pham\/tu-ao-3-canh-guong$/);
    expect(await page.content()).not.toContain("/san-pham/tu-ao-3-canh\"");
    const sitemap = await (await page.request.get("/sitemap.xml")).text();
    expect(sitemap).toContain("/san-pham/tu-ao-3-canh-guong<");
    expect(sitemap).not.toContain("/san-pham/tu-ao-3-canh<");
    await page.goto("/san-pham");
    await expect(page.locator('a[href="/san-pham/tu-ao-3-canh-guong"]').first()).toBeVisible();
    await expect(page.locator('a[href="/san-pham/tu-ao-3-canh"]')).toHaveCount(0);

    // Moving back to the first URL: no loop, the second one now redirects.
    await gotoReady(page, "/admin/san-pham/p2");
    await page.getByRole("button", { name: "Chỉnh sửa đường dẫn" }).click();
    await page.getByLabel("Đường dẫn sản phẩm").fill("tu-ao-3-canh");
    await page.getByRole("button", { name: "Lưu thay đổi" }).click();
    await page.getByRole("button", { name: "Đổi đường dẫn và lưu" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Đã đổi đường dẫn" })).toBeVisible();
    expect(await redirectOf(page, "/san-pham/tu-ao-3-canh-guong")).toEqual([301, "/san-pham/tu-ao-3-canh", "no-store"]);
    expect((await page.request.get("/san-pham/tu-ao-3-canh", { maxRedirects: 0 })).status()).toBe(200);
  });

  test("S2. invalid or taken URLs are refused at the field and keep what was typed", async ({ page }) => {
    writesFixture();
    await gotoReady(page, "/admin/san-pham/p2");
    await page.getByRole("button", { name: "Chỉnh sửa đường dẫn" }).click();
    await page.getByLabel("Đường dẫn sản phẩm").fill("Tủ Mới");
    await page.getByRole("button", { name: "Lưu thay đổi" }).click();
    await expect(page.getByText("Đường dẫn chỉ gồm chữ thường không dấu, số và dấu gạch ngang")).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Đổi đường dẫn sản phẩm?" })).toBeHidden();

    await page.getByLabel("Tên sản phẩm").fill("Tủ áo 3 cánh (đổi tên)");
    await page.getByLabel("Đường dẫn sản phẩm").fill("tu-5-tang"); // another product's URL
    await page.getByRole("button", { name: "Lưu thay đổi" }).click();
    await page.getByRole("button", { name: "Đổi đường dẫn và lưu" }).click();
    await expect(page.getByText("Đường dẫn này đang hoặc đã từng được sản phẩm khác dùng.")).toBeVisible();
    await expect(page.getByLabel("Đường dẫn sản phẩm")).toHaveValue("tu-5-tang");
    await expect(page.getByLabel("Tên sản phẩm")).toHaveValue("Tủ áo 3 cánh (đổi tên)");
    const saved = await (await page.request.get(`${mock}/api/v1/admin/products/p2`)).json();
    expect([saved.slug, saved.name]).toEqual(["tu-ao-3-canh", "Tủ áo 3 cánh có gương"]);

    // "Giữ đường dẫn cũ" puts the saved URL back without saving.
    await page.getByRole("button", { name: "Giữ đường dẫn cũ" }).click();
    await expect(page.locator("output")).toHaveText("/san-pham/tu-ao-3-canh");
  });

  test("S3. the confirmation fits the screen on desktop and phone", async ({ page }) => {
    await startEditingUrl(page, "tu-ao-3-canh-moi");
    const dialog = page.getByRole("dialog", { name: "Đổi đường dẫn sản phẩm?" });
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await expect(dialog.getByRole("button", { name: "Quay lại" })).toBeFocused(); // the safe choice gets focus, so Enter never moves a URL by accident
    await page.screenshot({ path: test.info().outputPath(`slug-dialog-${test.info().project.name}.png`) });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});
