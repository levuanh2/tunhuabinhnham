import { expect, test } from "@playwright/test";

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

test.describe("real Supabase CMS workflow", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!configured, "BLOCKED_EXTERNAL_CONFIGURATION: staging URL, admin credentials and explicit write approval are required");

  test("admin can publish and hide catalogue content", async ({ page, request }) => {
    const suffix = `${runId}-${Date.now()}`;
    const category = `${recordPrefix}category_${suffix}`;
    const categorySlug = `e2e-${suffix}-category`;
    const product = `${recordPrefix}product_${suffix}`;
    const productSlug = `e2e-${suffix}-product`;
    const sku = `E2E-${suffix}`;
    await page.goto("/admin/login");
    await page.getByLabel("Email").fill(email!);
    await page.getByLabel("Mật khẩu").fill(password!);
    await page.getByRole("button", { name: "Đăng nhập" }).click();
    await expect(page).toHaveURL(/\/admin(?:\/)?$/, { timeout: 15_000 });
    const token = await accessToken(page);
    const headers = { Authorization: `Bearer ${token}` };

    await page.goto("/admin/danh-muc");
    await page.getByLabel("Tên").fill(category);
    await page.getByLabel("Slug").fill(categorySlug);
    await page.getByRole("button", { name: "Thêm", exact: true }).click();
    await expect(page.getByText(category, { exact: true })).toBeVisible({ timeout: 15_000 });

    await page.goto("/admin/san-pham/moi");
    await page.getByLabel("Tên sản phẩm").fill(product);
    await page.getByLabel("Slug").fill(productSlug);
    await page.getByLabel("SKU").fill(sku);
    await page.getByLabel("Danh mục").selectOption({ label: category });
    await page.getByLabel("Ảnh sản phẩm").setInputFiles(image);
    await expect(page.getByText("Ảnh chính")).toBeVisible();
    await page.getByLabel("Xuất bản").selectOption("published");
    await page.getByRole("button", { name: "Lưu sản phẩm" }).click();
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

    await page.goto("/admin/san-pham");
    await page.getByRole("row", { name: new RegExp(sku) }).getByRole("link", { name: "Sửa" }).click();
    await page.getByLabel("Hiển thị sản phẩm").uncheck();
    await page.getByRole("button", { name: "Lưu sản phẩm" }).click();
    await expect(page).toHaveURL(/\/admin\/san-pham$/);
    await expect.poll(async () => (await request.get(`${apiUrl}/products/${productSlug}`)).status()).toBe(404);
    const hiddenResponse = await page.goto(`/san-pham/${productSlug}?e2e=${encodeURIComponent(runId)}`);
    expect(hiddenResponse?.status()).toBe(404);

    const productsResponse = await request.get(`${apiUrl}/admin/products?search=${encodeURIComponent(sku)}`, { headers });
    const createdProduct = (await productsResponse.json()).items?.find((item: { sku: string }) => item.sku === sku);
    if (createdProduct) {
      await request.patch(`${apiUrl}/admin/products/${createdProduct.id}`, { headers, data: { images: [], publish_status: "draft", is_visible: false } });
      for (const media of createdProduct.images ?? []) await request.delete(`${apiUrl}/admin/media?url=${encodeURIComponent(media.url)}`, { headers });
      await request.delete(`${apiUrl}/admin/products/${createdProduct.id}`, { headers });
    }
    const categoriesResponse = await request.get(`${apiUrl}/admin/categories`, { headers });
    const createdCategory = (await categoriesResponse.json()).find((item: { slug: string }) => item.slug === categorySlug);
    if (createdCategory) await request.delete(`${apiUrl}/admin/categories/${createdCategory.id}`, { headers });

    await page.goto("/admin");
    await page.getByRole("button", { name: "Đăng xuất" }).click();
    await expect(page).toHaveURL(/\/admin\/login$/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("admin can publish article, banner and branding media", async ({ page, request }) => {
    const suffix = `${runId}-${Date.now()}`;
    const postTitle = `${recordPrefix}post_${suffix}`;
    const postSlug = `e2e-${suffix}-post`;
    const bannerTitle = `${recordPrefix}banner_${suffix}`;

    await page.goto("/admin/login");
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

    await page.goto("/admin/bai-viet");
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

    await page.goto("/admin/banner");
    await page.getByLabel("Tiêu đề").fill(bannerTitle);
    await page.locator('fieldset:has-text("Ảnh banner") input[type=file]').setInputFiles(image);
    await page.getByRole("button", { name: "Thêm banner" }).click();
    await expect(page.getByText(bannerTitle, { exact: true })).toBeVisible();
    await page.goto("/");
    await expect(page.getByRole("heading", { name: bannerTitle })).toBeVisible();

    await page.goto("/admin/cai-dat");
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
});
