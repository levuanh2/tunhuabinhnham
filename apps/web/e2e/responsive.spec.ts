import { expect, test, type Page } from "@playwright/test";

/*
 * Responsive / touch regression suite. Runs ONLY against the local QA fixture server
 * (e2e/fixtures/mock-api.mjs) — it never talks to real Supabase. Setup:
 *   node apps/web/e2e/fixtures/mock-api.mjs
 *   apps/web/.env.local -> NEXT_PUBLIC_API_URL=http://localhost:8100/api/v1, NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:8100,
 *                          NEXT_PUBLIC_SUPABASE_ANON_KEY=qa-local-mock-key, NEXT_PUBLIC_SITE_URL=http://localhost:3100
 *   npx next dev -p 3100   (from apps/web)
 *   E2E_MOCK_API=1 E2E_BASE_URL=http://localhost:3100 npm --workspace apps/web run test:e2e -- responsive
 */
test.skip(process.env.E2E_MOCK_API !== "1", "Requires the local QA fixture API (E2E_MOCK_API=1)");

const WIDTHS: [number, number][] = [[320, 568], [360, 800], [375, 812], [390, 844], [412, 915], [430, 932], [768, 1024], [1024, 768], [1440, 900]];
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;

async function noOverflow(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll, "page must not scroll horizontally").toBeLessThanOrEqual(client);
}

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill("qa@example.test");
  await page.getByLabel("Mật khẩu").fill("qa-password-123");
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL(/\/admin\/?$/, { timeout: 30_000 });
}

test("1. no horizontal overflow on public pages across target viewports", async ({ page }) => {
  test.slow();
  for (const path of ["/", "/san-pham", "/san-pham/tu-5-tang", "/tin-tuc", "/tin-tuc/chon-tu-phong-ngu", "/lien-he"]) {
    for (const [width, height] of WIDTHS) {
      await page.setViewportSize({ width, height });
      await page.goto(path);
      await noOverflow(page);
    }
  }
});

test("2. mobile navigation opens as a modal sheet, locks scroll and closes with Escape", async ({ page }) => {
  test.skip(!isPhone(page), "phone layout only");
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Mở menu" });
  // Keyboard activation: Safari does not focus buttons on tap, so focus return is a keyboard-user guarantee.
  await trigger.focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Menu" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Sản phẩm" })).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe("hidden");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "Tìm sản phẩm" }).click();
  await expect(page.getByRole("dialog", { name: "Menu" }).getByRole("searchbox")).toBeFocused();
});

test("3. product grid uses 1 column under 340px, 2 on phones, 4 on desktop", async ({ page }) => {
  const columns = async () => page.locator("article").first().locator("xpath=..").evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length);
  for (const [width, expected] of [[320, 1], [390, 2], [1440, 4]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/san-pham");
    expect(await columns()).toBe(expected);
  }
});

test("4. product search and filters work on every layout", async ({ page }) => {
  await page.goto("/san-pham");
  await page.getByRole("searchbox").first().fill("tủ áo");
  await page.getByRole("searchbox").first().press("Enter");
  await expect(page).toHaveURL(/search=t%E1%BB%A7(\+|%20)%C3%A1o/);
  await expect(page.getByText("2 sản phẩm")).toBeVisible();
  await page.waitForLoadState("networkidle"); // the sheet trigger needs hydration
  if (isPhone(page)) await page.getByRole("button", { name: /^Lọc/ }).click();
  await page.getByLabel("Sắp xếp", { exact: true }).selectOption("price");
  await page.getByRole("button", { name: "Áp dụng" }).click();
  await expect(page).toHaveURL(/sort=price/);
  await expect(page).toHaveURL(/search=/);
});

test("5. product gallery: thumbnails select and touch track scrolls", async ({ page }) => {
  await page.goto("/san-pham/tu-5-tang");
  const thumb = page.getByRole("button", { name: "Xem ảnh 2 trên 3" });
  await thumb.click();
  await expect(thumb).toHaveAttribute("aria-pressed", "true");
  if (isPhone(page)) await expect(page.getByText("2/3")).toBeVisible();
});

test("6. Messenger CTA opens an allowed Facebook/Messenger URL; sticky CTA appears on phones", async ({ page }) => {
  await page.goto("/san-pham/tu-5-tang");
  await page.evaluate(() => { window.open = ((url?: string | URL) => { sessionStorage.setItem("opened", String(url)); return null; }) as typeof window.open; });
  await page.getByRole("button", { name: "Nhắn tin để mua" }).first().click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("opened"))).toMatch(/^https:\/\/(m\.me|(www\.)?facebook\.com)/);
  if (isPhone(page)) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
    const sticky = page.locator("div.fixed.bottom-0").filter({ has: page.getByRole("button", { name: "Nhắn tin để mua" }) });
    await expect(sticky).not.toHaveAttribute("inert", "");
  }
});

test("7. article body stays within a readable measure without overflow", async ({ page }) => {
  await page.goto("/tin-tuc/chon-tu-phong-ngu");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const width = await page.locator(".prose").evaluate(el => el.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(44 * 16 + 1);
  await noOverflow(page);
});

test("8. admin navigation: drawer on phones, sidebar on desktop", async ({ page }) => {
  await login(page);
  if (isPhone(page)) {
    await page.getByRole("button", { name: "Mở menu quản trị" }).click();
    const drawer = page.getByRole("dialog", { name: "Menu quản trị" });
    await expect(drawer.getByRole("link", { name: "Sản phẩm" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  } else {
    await expect(page.getByRole("navigation", { name: "Quản trị" }).getByRole("link", { name: "Sản phẩm" })).toBeVisible();
  }
  await page.goto("/admin/san-pham");
  await noOverflow(page);
});

test("9. admin product form shows validation next to the field", async ({ page }) => {
  await login(page);
  await page.goto("/admin/san-pham/moi");
  await page.getByRole("button", { name: "Lưu sản phẩm" }).click();
  await expect(page.getByText("Nhập tên sản phẩm")).toBeVisible();
  await expect(page.getByLabel("Tên sản phẩm")).toHaveAttribute("aria-invalid", "true");
  await noOverflow(page);
});

test("10. media upload controls are reachable and touch sized", async ({ page }) => {
  await login(page);
  await page.goto("/admin/san-pham/p1");
  await expect(page.getByLabel("Danh mục")).toHaveValue("c2");
  await expect(page.getByLabel("Ảnh sản phẩm")).toHaveAttribute("type", "file");
  await page.goto("/admin/cai-dat");
  const picker = page.getByText("Chọn ảnh").first();
  await expect(picker).toBeVisible();
  const box = await page.getByRole("button", { name: "Lưu thay đổi" }).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await noOverflow(page);
});
