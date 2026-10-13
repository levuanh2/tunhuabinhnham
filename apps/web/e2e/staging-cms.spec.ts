import { expect, test } from "@playwright/test";
import { toSlug } from "../src/lib/slug";

const canWrite = process.env.E2E_ALLOW_STAGING_WRITES === "true";
const email = process.env.E2E_ADMIN_EMAIL;
const password = process.env.E2E_ADMIN_PASSWORD;
const apiUrl = process.env.E2E_API_URL;
const suppliedAccessToken = process.env.E2E_ADMIN_ACCESS_TOKEN;
const runId = process.env.E2E_RUN_ID ?? Date.now().toString();
const recordPrefix = `__e2e_${runId}_`;
const configured = Boolean(process.env.E2E_BASE_URL && apiUrl && canWrite && email && password);
const image = { name: "e2e.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64") };

async function accessToken(page: import("@playwright/test").Page): Promise<string> {
  if (suppliedAccessToken) return suppliedAccessToken;
  return page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      const value = JSON.parse(localStorage.getItem(key) ?? "null");
      if (value?.access_token) return value.access_token as string;
    }
    throw new Error("Supabase access token was not found");
  });
}

/** Navigate and wait until the client has hydrated: react-hook-form/useState reset values typed into SSR markup. */
async function gotoReady(page: import("@playwright/test").Page, url: string) {
  await page.goto(url);
  await waitForHydration(page);
}

/** React attaches __reactFiber* keys to DOM nodes only when it has hydrated them. */
async function waitForHydration(page: import("@playwright/test").Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => {
    const el = document.querySelector("main input, main textarea, main select, main button");
    return !el || Object.keys(el).some(key => key.startsWith("__reactFiber"));
  });
}

async function login(page: import("@playwright/test").Page) {
  await gotoReady(page, "/admin/login");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Mật khẩu").fill(password!);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL(/\/admin(?:\/)?$/, { timeout: 15_000 });
}

test.describe("real Supabase CMS workflow", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!configured, "BLOCKED_EXTERNAL_CONFIGURATION: staging URL, admin credentials and explicit write approval are required");

  test("admin can publish and hide catalogue content", async ({ page, request }) => {
    const suffix = `${runId}-${Date.now()}`;
    const category = `${recordPrefix}category_${suffix}`;
    const categorySlug = toSlug(category); // the admin form derives it from the name
    const product = `${recordPrefix}product_${suffix}`;
    const productSlug = `e2e-${suffix}-product`;
    const sku = `E2E-${suffix}`;
    await gotoReady(page, "/admin/login");
    await page.getByLabel("Email").fill(email!);
    await page.getByLabel("Mật khẩu").fill(password!);
    await page.getByRole("button", { name: "Đăng nhập" }).click();
    await expect(page).toHaveURL(/\/admin(?:\/)?$/, { timeout: 15_000 });
    const token = await accessToken(page);
    const headers = { Authorization: `Bearer ${token}` };

    await gotoReady(page, "/admin/danh-muc");
    await page.getByLabel("Tên loại").fill(category);
    await page.getByRole("button", { name: "Thêm loại", exact: true }).click();
    await expect(page.getByText(category, { exact: true })).toBeVisible({ timeout: 15_000 });

    await gotoReady(page, "/admin/san-pham/moi");
    await page.getByLabel("Tên sản phẩm").fill(product);
    await page.getByRole("button", { name: "Chỉnh sửa đường dẫn" }).click();
    await page.getByLabel("Đường dẫn sản phẩm").fill(productSlug);
    await page.getByLabel("Mã sản phẩm").fill(sku);
    await page.getByLabel("Loại sản phẩm").selectOption({ label: category });
    await page.getByLabel("Ảnh sản phẩm").setInputFiles(image);
    await expect(page.getByText("Ảnh chính")).toBeVisible();
    await page.getByLabel("Trạng thái đăng bán").selectOption("published");
    await page.getByRole("button", { name: "Đăng sản phẩm" }).click();
    await expect(page).toHaveURL(/\/admin\/san-pham$/);

    await page.goto(`/san-pham/${productSlug}`);
    await expect(page.getByRole("heading", { name: product })).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(window, "open", {
        configurable: true,
        value: (url?: string | URL) => {
          sessionStorage.setItem("e2e-opened-url", String(url ?? ""));
          return null;
        },
      });
    });
    await page.getByRole("button", { name: /Nhắn tin để mua/i }).click();
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem("e2e-opened-url"))).toMatch(/^(https:\/\/)?(www\.)?(facebook\.com|m\.me|messenger\.com|fb\.me)/);

    await gotoReady(page, "/admin/san-pham");
    // Desktop shows a table, phones a card list: the product-name link exists in both layouts.
    await page.getByRole("link", { name: product }).first().click();
    await page.getByLabel("Hiển thị trên website").uncheck();
    await page.getByRole("button", { name: "Lưu thay đổi" }).click();
    await expect(page).toHaveURL(/\/admin\/san-pham$/);
    await expect.poll(async () => (await request.get(`${apiUrl}/products/${productSlug}`)).status()).toBe(404);
    const hiddenResponse = await page.goto(`/san-pham/${productSlug}?e2e=${encodeURIComponent(runId)}`);
    expect(hiddenResponse?.status()).toBe(404);

    const productsResponse = await request.get(`${apiUrl}/admin/products?search=${encodeURIComponent(product)}`, { headers });
    const createdProduct = (await productsResponse.json()).items?.find((item: { sku: string }) => item.sku === sku);
    if (createdProduct) {
      await request.patch(`${apiUrl}/admin/products/${createdProduct.id}`, { headers, data: { images: [], publish_status: "draft", is_visible: false } });
      for (const media of createdProduct.images ?? []) await request.delete(`${apiUrl}/admin/media?url=${encodeURIComponent(media.url)}`, { headers });
      await request.delete(`${apiUrl}/admin/products/${createdProduct.id}`, { headers });
    }
    const categoriesResponse = await request.get(`${apiUrl}/admin/categories`, { headers });
    const createdCategory = (await categoriesResponse.json()).find((item: { slug: string }) => item.slug === categorySlug);
    if (createdCategory) await request.delete(`${apiUrl}/admin/categories/${createdCategory.id}`, { headers });

    await gotoReady(page, "/admin");
    const adminMenu = page.getByRole("button", { name: "Mở menu quản trị" });
    if (await adminMenu.isVisible()) await adminMenu.click();
    await page.getByRole("button", { name: "Đăng xuất" }).click();
    await expect(page).toHaveURL(/\/admin\/login$/);
    await gotoReady(page, "/admin");
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("admin can publish article, banner and branding media", async ({ page, request }) => {
    const suffix = `${runId}-${Date.now()}`;
    const postTitle = `${recordPrefix}post_${suffix}`;
    const postSlug = `e2e-${suffix}-post`;
    const bannerTitle = `${recordPrefix}banner_${suffix}`;

    await gotoReady(page, "/admin/login");
    await page.getByLabel("Email").fill(email!);
    await page.getByLabel("Mật khẩu").fill(password!);
    await page.getByRole("button", { name: "Đăng nhập" }).click();
    await expect(page).toHaveURL(/\/admin(?:\/)?$/, { timeout: 15_000 });
    const token = await accessToken(page);
    const headers = { Authorization: `Bearer ${token}` };
    const originalSettingsResponse = await request.get(`${apiUrl}/admin/site-settings`, { headers });
    expect(originalSettingsResponse.ok()).toBeTruthy();
    const originalSettings = await originalSettingsResponse.json();
    const originalBannersResponse = await request.get(`${apiUrl}/admin/banners`, { headers });
    const originalBanners = await originalBannersResponse.json();
    for (const [index, banner] of originalBanners.entries()) {
      await request.patch(`${apiUrl}/admin/banners/${banner.id}`, { headers, data: { sort_order: 1000 + index } });
    }

    await gotoReady(page, "/admin/bai-viet");
    await page.getByLabel("Tiêu đề").fill(postTitle);
    await page.getByLabel("Slug").fill(postSlug);
    await page.getByLabel("Nội dung HTML").fill("<p>Nội dung kiểm thử staging.</p>");
    await page.getByLabel("Trạng thái").selectOption("published");
    await page.locator('fieldset:has-text("Ảnh bài viết") input[type=file]').setInputFiles(image);
    await expect(page.getByRole("button", { name: "Ảnh cover" })).toBeVisible();
    await page.getByRole("button", { name: "Tạo bài viết" }).click();
    await expect(page.getByText(postTitle, { exact: true })).toBeVisible();
    await page.goto(`/tin-tuc/${postSlug}`);
    await expect(page.getByRole("heading", { name: postTitle })).toBeVisible();

    await gotoReady(page, "/admin/banner");
    await page.getByLabel("Tiêu đề").fill(bannerTitle);
    await page.locator('fieldset:has-text("Ảnh banner") input[type=file]').setInputFiles(image);
    await page.getByRole("button", { name: "Thêm banner" }).click();
    await expect(page.getByText(bannerTitle, { exact: true })).toBeVisible();
    await page.goto("/");
    await expect(page.getByRole("heading", { name: bannerTitle })).toBeVisible();

    await gotoReady(page, "/admin/cai-dat");
    await page.locator('fieldset:has-text("Logo") input[type=file]').setInputFiles(image);
    await page.locator('fieldset:has-text("Favicon") input[type=file]').setInputFiles(image);
    await page.getByRole("button", { name: "Lưu thay đổi" }).click();
    await expect(page.getByText("Đã lưu cài đặt")).toBeVisible();
    const changedSettingsResponse = await request.get(`${apiUrl}/admin/site-settings`, { headers });
    const changedSettings = await changedSettingsResponse.json();
    expect(changedSettings.logo_url).not.toBe(originalSettings.logo_url);
    expect(changedSettings.favicon_url).not.toBe(originalSettings.favicon_url);

    const restore = await request.patch(`${apiUrl}/admin/site-settings`, {
      headers,
      data: {
        store_name: originalSettings.store_name,
        logo_url: originalSettings.logo_url,
        favicon_url: originalSettings.favicon_url,
        facebook_url: originalSettings.facebook_url,
        messenger_url: originalSettings.messenger_url,
        hotline: originalSettings.hotline,
        address: originalSettings.address,
        about_text: originalSettings.about_text,
        default_seo_title: originalSettings.default_seo_title,
        default_seo_description: originalSettings.default_seo_description,
        contact_tracking_enabled: originalSettings.contact_tracking_enabled,
      },
    });
    expect(restore.ok()).toBeTruthy();
    for (const url of [changedSettings.logo_url, changedSettings.favicon_url]) {
      if (url && url !== originalSettings.logo_url && url !== originalSettings.favicon_url) {
        await request.delete(`${apiUrl}/admin/media?url=${encodeURIComponent(url)}`, { headers });
      }
    }

    const postsResponse = await request.get(`${apiUrl}/admin/posts`, { headers });
    const post = (await postsResponse.json()).find((item: { slug: string }) => item.slug === postSlug);
    if (post) {
      await request.patch(`${apiUrl}/admin/posts/${post.id}`, { headers, data: { images: [], cover_image_url: null, publish_status: "draft" } });
      for (const media of post.images ?? []) await request.delete(`${apiUrl}/admin/media?url=${encodeURIComponent(media.url)}`, { headers });
      await request.delete(`${apiUrl}/admin/posts/${post.id}`, { headers });
    }
    const bannersResponse = await request.get(`${apiUrl}/admin/banners`, { headers });
    const banner = (await bannersResponse.json()).find((item: { title: string }) => item.title === bannerTitle);
    if (banner) {
      await request.patch(`${apiUrl}/admin/banners/${banner.id}`, { headers, data: { image_url: "https://example.com/e2e-cleanup.png", is_active: false } });
      await request.delete(`${apiUrl}/admin/media?url=${encodeURIComponent(banner.image_url)}`, { headers });
      await request.delete(`${apiUrl}/admin/banners/${banner.id}`, { headers });
    }
    for (const bannerItem of originalBanners) {
      await request.patch(`${apiUrl}/admin/banners/${bannerItem.id}`, { headers, data: { sort_order: bannerItem.sort_order, is_active: bannerItem.is_active } });
    }
  });
  test("draft → publish keeps category, persists image order and primary, invalidates cache", async ({ page, request }) => {
    const suffix = `${runId}-${Date.now()}`;
    const productName = `${recordPrefix}order_${suffix}`;
    const productSlug = `e2e-${suffix}-order`;
    const sku = `E2E-O-${suffix}`;
    await login(page);
    const headers = { Authorization: `Bearer ${await accessToken(page)}` };
    const category = await (await request.post(`${apiUrl}/admin/categories`, { headers, data: { name: `${recordPrefix}cat_${suffix}`, slug: `e2e-${suffix}-cat`, is_visible: true, sort_order: 0 } })).json();
    let productId: string | undefined;
    try {
      await gotoReady(page, "/admin/san-pham/moi");
      await page.getByLabel("Tên sản phẩm").fill(productName);
      await page.getByLabel("Slug").fill(productSlug);
      await page.getByLabel("SKU").fill(sku);
      await page.getByLabel("Danh mục").selectOption(category.id);
      await page.getByLabel("Ảnh sản phẩm").setInputFiles(["a", "b", "c"].map(name => ({ ...image, name: `e2e-${name}.png` })));
      await expect(page.locator("form li")).toHaveCount(3);
      await expect(page.getByLabel("Xuất bản")).toHaveValue("draft");
      await page.getByRole("button", { name: "Lưu sản phẩm" }).click();
      await expect(page).toHaveURL(/\/admin\/san-pham$/);
      const created = (await (await request.get(`${apiUrl}/admin/products?search=${encodeURIComponent(productName)}`, { headers })).json()).items.find((p: { sku: string }) => p.sku === sku);
      productId = created.id;
      expect(created.publish_status).toBe("draft");
      expect((await request.get(`${apiUrl}/products/${productSlug}`)).status()).toBe(404);
      const keys = [...created.images].sort((x: { sort_order: number }, y: { sort_order: number }) => x.sort_order - y.sort_order).map((i: { storage_key: string }) => i.storage_key);

      // Edit an unrelated field only: category must be retained.
      await gotoReady(page, `/admin/san-pham/${productId}`);
      await expect(page.getByLabel("Danh mục")).toHaveValue(category.id);
      await page.getByLabel("Mô tả", { exact: true }).fill("Mô tả kiểm thử Gate C1.");
      await page.getByRole("button", { name: "Lưu sản phẩm" }).click();
      await expect(page).toHaveURL(/\/admin\/san-pham$/);
      const edited = await (await request.get(`${apiUrl}/admin/products/${productId}`, { headers })).json();
      expect(edited.category_id).toBe(category.id);
      expect(edited.description).toBe("Mô tả kiểm thử Gate C1.");

      // Reorder (1st image moves behind 2nd), make the last image primary, then publish.
      await gotoReady(page, `/admin/san-pham/${productId}`);
      await page.getByRole("button", { name: "Đưa ảnh 1 ra sau" }).click();
      await page.locator("form li").nth(2).getByRole("button", { name: "Đặt làm ảnh chính" }).click();
      await page.getByLabel("Xuất bản").selectOption("published");
      await page.getByRole("button", { name: "Lưu sản phẩm" }).click();
      await expect(page).toHaveURL(/\/admin\/san-pham$/);
      const saved = await (await request.get(`${apiUrl}/admin/products/${productId}`, { headers })).json();
      const ordered = [...saved.images].sort((x: { sort_order: number }, y: { sort_order: number }) => x.sort_order - y.sort_order);
      expect(ordered.map((i: { storage_key: string }) => i.storage_key)).toEqual([keys[1], keys[0], keys[2]]);
      expect(ordered.find((i: { is_primary: boolean }) => i.is_primary).storage_key).toBe(keys[2]);
      expect(saved.category_id).toBe(category.id);

      // Reload the editor: UI reflects the persisted order, primary and category.
      await gotoReady(page, `/admin/san-pham/${productId}`);
      await expect(page.locator("form li").nth(2).getByText("Ảnh chính")).toBeVisible();
      await expect(page.getByLabel("Danh mục")).toHaveValue(category.id);

      // Cache invalidation: the published product is now public on detail and listing pages.
      await expect.poll(async () => (await page.goto(`/san-pham/${productSlug}?e2e=${encodeURIComponent(suffix)}`))?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: productName })).toBeVisible();
      await page.goto(`/san-pham?search=${encodeURIComponent(productName)}`);
      await expect(page.getByRole("link", { name: productName })).toBeVisible();
    } finally {
      if (productId) {
        const current = await (await request.get(`${apiUrl}/admin/products/${productId}`, { headers })).json();
        await request.patch(`${apiUrl}/admin/products/${productId}`, { headers, data: { images: [], publish_status: "draft", is_visible: false } });
        for (const media of current.images ?? []) await request.delete(`${apiUrl}/admin/media?url=${encodeURIComponent(media.url)}`, { headers });
        await request.delete(`${apiUrl}/admin/products/${productId}`, { headers });
      }
      await request.delete(`${apiUrl}/admin/categories/${category.id}`, { headers });
    }
  });

  test("Supabase SSR session survives reload, invalid session is rejected, logout clears cookies", async ({ page, browser, baseURL }) => {
    await login(page);
    await gotoReady(page, "/admin/san-pham");
    await expect(page).toHaveURL(/\/admin\/san-pham$/);
    await page.reload();
    await expect(page).toHaveURL(/\/admin\/san-pham$/);
    const authCookies = (await page.context().cookies()).filter(c => c.name.startsWith("sb-") && c.name.includes("auth-token"));
    expect(authCookies.length).toBeGreaterThan(0);

    // A second page in the same browser context shares the SSR session (server-side middleware check).
    const second = await page.context().newPage();
    await second.goto("/admin/bai-viet");
    await expect(second).toHaveURL(/\/admin\/bai-viet$/);
    await second.close();

    // Expired session: a well-formed Supabase SSR cookie whose access token expired and whose refresh token
    // is unknown must be rejected by middleware (no refresh, redirect to login).
    const ordered = [...authCookies].sort((x, y) => x.name.localeCompare(y.name, "en", { numeric: true }));
    const raw = ordered.map(c => decodeURIComponent(c.value)).join("");
    const json = JSON.parse(Buffer.from(raw.replace(/^base64-/, ""), "base64url").toString("utf8"));
    const expired = { ...json, access_token: "expired.invalid.token", refresh_token: "e2e-unknown-refresh-token", expires_at: Math.floor(Date.now() / 1000) - 3600, expires_in: -3600 };
    const baseName = ordered[0].name.replace(/\.\d+$/, "");
    const stale = await browser.newContext({ baseURL });
    await stale.addCookies([{ ...ordered[0], name: baseName, value: `base64-${Buffer.from(JSON.stringify(expired)).toString("base64url")}` }]);
    const stalePage = await stale.newPage();
    await stalePage.goto("/admin/san-pham");
    await expect(stalePage).toHaveURL(/\/admin\/login/);
    await stale.close();

    const adminMenu = page.getByRole("button", { name: "Mở menu quản trị" });
    if (await adminMenu.isVisible()) await adminMenu.click();
    await page.getByRole("button", { name: "Đăng xuất" }).click();
    await expect(page).toHaveURL(/\/admin\/login$/);
    expect((await page.context().cookies()).filter(c => c.name.startsWith("sb-") && c.name.includes("auth-token") && c.value)).toHaveLength(0);
    await gotoReady(page, "/admin/cai-dat");
    await expect(page).toHaveURL(/\/admin\/login/);

    // Back button after logout must not resurrect a protected page (no bfcache/HTTP cache copy).
    await page.goBack();
    await expect(page).not.toHaveURL(/\/admin\/(san-pham|bai-viet|cai-dat)$/);

    // Replaying the cookies captured while signed in must fail: logout revoked the Supabase session.
    const replay = await browser.newContext({ baseURL });
    await replay.addCookies(authCookies);
    const replayPage = await replay.newPage();
    await replayPage.goto("/admin/san-pham");
    await expect(replayPage).toHaveURL(/\/admin\/login/);
    await replay.close();
  });

  test("mobile admin workflow: drawer navigation and draft product creation", async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "phone-only workflow");
    const suffix = `${runId}-${Date.now()}`;
    const productName = `${recordPrefix}mobile_${suffix}`;
    const sku = `E2E-M-${suffix}`;
    await login(page);
    const headers = { Authorization: `Bearer ${await accessToken(page)}` };
    let productId: string | undefined;
    try {
      await page.getByRole("button", { name: "Mở menu quản trị" }).click();
      await page.getByRole("dialog", { name: "Menu quản trị" }).getByRole("link", { name: "Sản phẩm" }).click();
      await expect(page).toHaveURL(/\/admin\/san-pham$/);
      await page.getByRole("link", { name: "Thêm sản phẩm" }).first().click();
      await expect(page).toHaveURL(/\/admin\/san-pham\/moi$/);
      await waitForHydration(page);
      await page.getByLabel("Tên sản phẩm").fill(productName);
      await page.getByLabel("Slug").fill(`e2e-${suffix}-mobile`);
      await page.getByLabel("SKU").fill(sku);
      await page.getByLabel("Ảnh sản phẩm").setInputFiles({ ...image, name: "e2e-mobile.png" });
      await expect(page.getByText("Ảnh chính")).toBeVisible();
      await page.getByRole("button", { name: "Lưu sản phẩm" }).click();
      await expect(page).toHaveURL(/\/admin\/san-pham$/);
      const created = (await (await request.get(`${apiUrl}/admin/products?search=${encodeURIComponent(productName)}`, { headers })).json()).items.find((p: { sku: string }) => p.sku === sku);
      productId = created.id;
      expect(created.publish_status).toBe("draft");
      expect(created.images).toHaveLength(1);
      const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(scroll).toBeLessThanOrEqual(client);
    } finally {
      if (productId) {
        const current = await (await request.get(`${apiUrl}/admin/products/${productId}`, { headers })).json();
        await request.patch(`${apiUrl}/admin/products/${productId}`, { headers, data: { images: [], is_visible: false } });
        for (const media of current.images ?? []) await request.delete(`${apiUrl}/admin/media?url=${encodeURIComponent(media.url)}`, { headers });
        await request.delete(`${apiUrl}/admin/products/${productId}`, { headers });
      }
    }
  });
});
