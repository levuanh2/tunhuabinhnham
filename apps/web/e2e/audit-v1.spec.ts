import { expect, test, type Page } from "@playwright/test";
import { gotoReady } from "./hydration";

/*
 * Final V1 audit: admin CMS flows that had no fixture coverage (news, banners, contact settings reaching the
 * public CTAs, session expiry mid-session). Fixture API only; writes stay in the fixture's memory.
 * Run with MOCK_WRITABLE_SETTINGS=1 on both the mock server and the test process for the settings test.
 */
test.skip(process.env.E2E_MOCK_API !== "1", "Requires the local QA fixture API (E2E_MOCK_API=1)");
test.beforeEach(() => test.skip(test.info().project.name !== "desktop", "writes fixture state; run once per engine config"));

const mock = process.env.E2E_MOCK_API_URL ?? "http://127.0.0.1:8100";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

async function login(page: Page) {
  await gotoReady(page, "/admin/login");
  await page.getByLabel("Email").fill("qa@example.test");
  await page.getByLabel("Mật khẩu").fill("qa-password-123");
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL(/\/admin\/?$/, { timeout: 30_000 });
}

test("A1. news: create and publish an article; it appears on /tin-tuc and on its own page", async ({ page }) => {
  const slug = `bai-audit-${Date.now()}`;
  const title = `Bài kiểm thử audit ${slug.slice(-6)}`; // the fixture keeps posts across runs
  await login(page);
  await gotoReady(page, "/admin/bai-viet");
  await page.getByLabel("Tiêu đề").fill(title);
  await page.getByLabel("Slug").fill(slug);
  await page.getByLabel("Tóm tắt").fill("Tóm tắt kiểm thử");
  await page.getByLabel("Nội dung HTML").fill("<p>Nội dung <strong>kiểm thử</strong>.</p>");
  await page.getByLabel("Trạng thái").selectOption("published");
  const revalidated = page.waitForResponse(r => r.url().endsWith("/api/revalidate") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Tạo bài viết" }).click();
  expect((await revalidated).status()).toBe(200);
  await expect(page.getByText(title)).toBeVisible();
  await page.goto(`/tin-tuc/${slug}`);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.locator(".prose strong")).toHaveText("kiểm thử");
  await page.goto("/tin-tuc");
  await expect(page.getByText(title)).toBeVisible();
});

test("A2. banners: add a banner with an uploaded image; it is listed in admin", async ({ page }) => {
  await login(page);
  await gotoReady(page, "/admin/banner");
  const title = `Banner audit ${Date.now()}`;
  await page.getByLabel("Tiêu đề").fill(title);
  await page.getByLabel("Phụ đề").fill("Phụ đề kiểm thử");
  await page.locator("input[type=file]").first().setInputFiles({ name: "banner.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: /Thêm banner|Lưu banner|Tạo banner/ }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
});

test("A3. settings: hotline and Messenger saved in admin drive the public contact CTAs", async ({ page, request }) => {
  test.skip(process.env.MOCK_WRITABLE_SETTINGS !== "1", "needs MOCK_WRITABLE_SETTINGS=1");
  await request.post(`${mock}/__reset`);
  try {
    await login(page);
    await gotoReady(page, "/admin/cai-dat");
    await page.getByLabel("Hotline").fill("0912 345 678");
    await page.getByLabel("Messenger URL").fill("https://m.me/tunhuabinhnham.test");
    await page.getByRole("button", { name: "Lưu thay đổi" }).click();
    await expect(page.getByText(/Đã lưu/).first()).toBeVisible();
    await page.goto("/lien-he");
    await expect(page.locator('a[href^="tel:"]').first()).toHaveAttribute("href", /tel:0912\s?345\s?678|tel:0912345678/);
    await expect(page.locator('a[href^="https://m.me/"]').first()).toHaveAttribute("href", "https://m.me/tunhuabinhnham.test");
  } finally {
    await request.post(`${mock}/__reset`);
  }
});

test("A4. a session that expires mid-session is reported in Vietnamese and leads back to login", async ({ page }) => {
  await login(page);
  await gotoReady(page, "/admin/san-pham/moi");
  await page.getByLabel("Tên sản phẩm").fill("Tủ phiên hết hạn");
  // The API now rejects the token (expired/revoked).
  await page.route("**/api/v1/admin/products", route => route.request().method() === "POST" ? route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { message: "Authentication required" } }) }) : route.continue());
  await page.getByRole("button", { name: "Lưu bản nháp" }).click();
  await expect(page.getByText("Phiên đăng nhập đã hết hạn")).toBeVisible();
  await expect(page.getByLabel("Tên sản phẩm")).toHaveValue("Tủ phiên hết hạn"); // input kept
  await gotoReady(page, "/admin/san-pham");
  await expect(page).toHaveURL(/\/admin\/login/);
});

test("A5. product images: upload two, make the second primary, remove the first, save; the stored order is consistent", async ({ page, request }) => {
  await request.post(`${mock}/__reset`);
  try {
    await login(page);
    await gotoReady(page, "/admin/san-pham/moi");
    await page.getByLabel("Tên sản phẩm").fill("Tủ ảnh audit");
    await page.getByLabel("Ảnh sản phẩm").setInputFiles([
      { name: "a.png", mimeType: "image/png", buffer: PNG },
      { name: "b.png", mimeType: "image/png", buffer: PNG },
    ]);
    await expect(page.getByRole("button", { name: "Gỡ ảnh" })).toHaveCount(2); // both uploads listed
    await expect(page.getByText("Ảnh chính", { exact: true })).toHaveCount(1); // exactly one primary badge
    await page.getByRole("button", { name: "Đặt làm ảnh chính" }).click();
    await page.getByRole("button", { name: "Gỡ ảnh" }).first().click();
    await expect(page.getByRole("button", { name: "Gỡ ảnh" })).toHaveCount(1); // removal is immediate in the form (the file is deleted after the save, see A6)
    await page.getByRole("button", { name: "Lưu bản nháp" }).click();
    await expect(page).toHaveURL(/\/admin\/san-pham$/);
    const items = (await (await request.get(`${mock}/api/v1/admin/products?page_size=100`)).json()).items as { name: string; images: { sort_order: number; is_primary: boolean }[] }[];
    const saved = items.find(p => p.name === "Tủ ảnh audit")!;
    expect(saved.images.map(i => [i.sort_order, i.is_primary])).toEqual([[0, true]]);
  } finally {
    await request.post(`${mock}/__reset`);
  }
});

/** Records media uploads, media deletes (slowed down, as on a real network) and saves to `path`, in order. */
async function trackMedia(page: Page, savePath: RegExp) {
  const uploads: string[] = [];
  const events: string[] = [];
  page.on("response", async r => {
    const method = r.request().method();
    if (method === "POST" && /\/admin\/media\?/.test(r.url())) uploads.push((await r.json()).url);
    if ((method === "POST" || method === "PATCH") && savePath.test(new URL(r.url()).pathname)) events.push(`saved ${r.status()}`);
  });
  await page.route("**/api/v1/admin/media**", async route => {
    if (route.request().method() === "DELETE") {
      events.push(`delete ${new URL(route.request().url()).searchParams.get("url")}`);
      await new Promise(r => setTimeout(r, 800));
    }
    await route.continue();
  });
  return { uploads, events };
}

test("A6. V1-BUG-01: removing an image and saving at once keeps only the remaining image; the file is deleted after the save", async ({ page, request }) => {
  await request.post(`${mock}/__reset`);
  try {
    await login(page);
    await gotoReady(page, "/admin/san-pham/moi");
    await page.getByLabel("Tên sản phẩm").fill("Tủ race audit");
    const { uploads, events } = await trackMedia(page, /\/admin\/products$/);
    await page.getByLabel("Ảnh sản phẩm").setInputFiles([{ name: "a.png", mimeType: "image/png", buffer: PNG }, { name: "b.png", mimeType: "image/png", buffer: PNG }]);
    await expect(page.getByRole("button", { name: "Gỡ ảnh" })).toHaveCount(2);
    await page.getByRole("button", { name: "Gỡ ảnh" }).first().click();
    await page.getByRole("button", { name: "Lưu bản nháp" }).dblclick(); // a quick owner, double-clicking
    await expect(page).toHaveURL(/\/admin\/san-pham$/);
    await expect.poll(() => events.length).toBe(2);
    // One save, then the delete of the removed file, never the other way round.
    expect(events).toEqual(["saved 201", `delete ${uploads[0]}`]);
    const items = (await (await request.get(`${mock}/api/v1/admin/products?page_size=100`)).json()).items as { name: string; images: { url: string; is_primary: boolean }[] }[];
    const saved = items.filter(p => p.name === "Tủ race audit");
    expect(saved).toHaveLength(1);
    expect(saved[0].images.map(i => [i.url, i.is_primary])).toEqual([[uploads[1], true]]);
  } finally {
    await request.post(`${mock}/__reset`);
  }
});

test("A7. V1-BUG-01 (news): removing an image and saving at once keeps only the remaining image; the file is deleted after the save", async ({ page, request }) => {
  const slug = `bai-race-${Date.now()}`;
  await login(page);
  await gotoReady(page, "/admin/bai-viet");
  await page.getByLabel("Tiêu đề").fill(`Bài race ${slug.slice(-6)}`);
  await page.getByLabel("Slug").fill(slug);
  const { uploads, events } = await trackMedia(page, /\/admin\/posts$/);
  await page.locator("fieldset", { hasText: "Ảnh bài viết" }).locator("input[type=file]").setInputFiles([{ name: "a.png", mimeType: "image/png", buffer: PNG }, { name: "b.png", mimeType: "image/png", buffer: PNG }]);
  const remove = page.locator("fieldset", { hasText: "Ảnh bài viết" }).getByRole("button", { name: "Gỡ ảnh" });
  await expect(remove).toHaveCount(2);
  await remove.first().click(); // the cover image
  await page.getByRole("button", { name: "Tạo bài viết" }).click();
  await expect.poll(() => events.length).toBe(2);
  expect(events).toEqual(["saved 201", `delete ${uploads[0]}`]);
  const posts = (await (await request.get(`${mock}/api/v1/admin/posts`)).json()) as { slug: string; cover_image_url: string; images: { url: string }[] }[];
  const saved = posts.find(p => p.slug === slug)!;
  expect(saved.images.map(i => i.url)).toEqual([uploads[1]]);
  expect(saved.cover_image_url).toBe(uploads[1]);
});

test("A8. V1-BUG-01 (banner): replacing an image deletes the old file only after the banner is saved", async ({ page }) => {
  await login(page);
  await gotoReady(page, "/admin/banner");
  await page.getByLabel("Tiêu đề").fill(`Banner race ${Date.now()}`);
  const { uploads, events } = await trackMedia(page, /\/admin\/banners$/);
  await page.locator("input[type=file]").first().setInputFiles({ name: "a.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByRole("button", { name: "Gỡ ảnh" })).toBeVisible();
  await page.locator("input[type=file]").first().setInputFiles({ name: "b.png", mimeType: "image/png", buffer: PNG }); // "Thay ảnh"
  await expect.poll(() => uploads.length).toBe(2);
  expect(events).toEqual([]); // nothing deleted before the save
  await page.getByRole("button", { name: /Thêm banner|Lưu banner|Tạo banner/ }).click();
  await expect.poll(() => events.length).toBe(2);
  expect(events).toEqual(["saved 201", `delete ${uploads[0]}`]);
});
