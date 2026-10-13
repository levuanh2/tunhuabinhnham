import { expect, test, type Page } from "@playwright/test";

/*
 * Product form, product categories ("Loại sản phẩm") and the public category filter.
 * Runs ONLY against the local QA fixture server (e2e/fixtures/mock-api.mjs), like responsive.spec.ts;
 * the fixture mirrors the API's slug/SKU unique constraints and the category delete guard.
 * Specs that write to the fixture run on the desktop project only and reset it afterwards.
 */
test.skip(process.env.E2E_MOCK_API !== "1", "Requires the local QA fixture API (E2E_MOCK_API=1)");

const mock = process.env.E2E_MOCK_API_URL ?? "http://127.0.0.1:8100";
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;
const writesFixture = () => test.skip(test.info().project.name !== "desktop", "mutates shared fixture state; run once");
type Saved = { id: string; name: string; slug: string; sku: string; price: string | null; category_id: string | null; publish_status: string; published_at: string | null; is_visible: boolean };

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill("qa@example.test");
  await page.getByLabel("Mật khẩu").fill("qa-password-123");
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL(/\/admin\/?$/, { timeout: 30_000 });
}

async function noOverflow(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll, "page must not scroll horizontally").toBeLessThanOrEqual(client);
}

async function savedProducts(page: Page): Promise<Saved[]> {
  return (await (await page.request.get(`${mock}/api/v1/admin/products?page_size=100`)).json()).items;
}

async function newProductPage(page: Page) {
  await page.goto("/admin/san-pham/moi");
  await expect(page.getByLabel("Loại sản phẩm").locator("option", { hasText: "Tủ quần áo" })).toBeAttached(); // categories loaded
}

test.describe("product form", () => {
  test.beforeEach(async ({ page }) => { await page.request.post(`${mock}/__reset`); await login(page); });
  test.afterAll(async ({ request }) => { await request.post(`${mock}/__reset`); });

  test("P1. the URL is generated from a Vietnamese name and stops following it after a manual edit", async ({ page }) => {
    await newProductPage(page);
    await page.getByLabel("Tên sản phẩm").fill("Tủ nhựa 5 tầng màu trắng");
    await expect(page.locator("output")).toHaveText("/san-pham/tu-nhua-5-tang-mau-trang");
    await page.getByLabel("Tên sản phẩm").fill("Đồ dùng ĐẸP & bền!!");
    await expect(page.locator("output")).toHaveText("/san-pham/do-dung-dep-ben");
    await expect(page.getByText("Tự tạo từ tên sản phẩm.")).toBeVisible();

    await page.getByRole("button", { name: "Chỉnh sửa đường dẫn" }).click();
    await expect(page.getByLabel("Đường dẫn sản phẩm")).toBeFocused();
    await page.getByLabel("Đường dẫn sản phẩm").fill("tu-rieng");
    await page.getByLabel("Tên sản phẩm").fill("Tên khác hẳn");
    await expect(page.getByLabel("Đường dẫn sản phẩm")).toHaveValue("tu-rieng");
    await page.getByRole("button", { name: "Tạo lại từ tên" }).click();
    await expect(page.locator("output")).toHaveText("/san-pham/ten-khac-han");

    await page.getByLabel("Tên sản phẩm").fill("!!!");
    await page.getByRole("button", { name: "Lưu bản nháp" }).click();
    await expect(page.getByText("Tên sản phẩm cần có chữ hoặc số để tạo đường dẫn")).toBeVisible();
    await page.getByLabel("Giá bán (VNĐ)").fill("một triệu");
    await page.getByLabel("Giá bán (VNĐ)").blur();
    await expect(page.getByText("Nhập giá bằng số, ví dụ 1.250.000")).toBeVisible();
    await noOverflow(page);
  });

  test("P2. blank product code, duplicate name gets -2, category and price saved, draft vs publish", async ({ page }) => {
    writesFixture();
    for (const round of [1, 2]) {
      await newProductPage(page);
      await page.getByLabel("Tên sản phẩm").fill("Tủ đa năng 4 tầng");
      await page.getByLabel("Loại sản phẩm").selectOption({ label: "Kệ bếp" });
      await page.getByLabel("Giá bán (VNĐ)").fill("1.250.000");
      await expect(page.getByRole("button", { name: "Lưu bản nháp" })).toBeVisible();
      if (round === 2) {
        await page.getByLabel("Trạng thái đăng bán").selectOption("published");
        await expect(page.getByText("Khách xem được sản phẩm này trên website.")).toBeVisible();
        // First publish: the URL is fixed from now on, so it is shown for a last check.
        const note = page.getByRole("note");
        await expect(note).toContainText("Kiểm tra đường dẫn trước khi đăng");
        await expect(note).toContainText("/san-pham/tu-da-nang-4-tang");
        await expect(page.getByText("Kiểm tra kỹ: sau khi đăng, đường dẫn này sẽ không đổi được.")).toBeVisible();
      }
      const revalidated = page.waitForResponse(response => response.url().endsWith("/api/revalidate") && response.request().method() === "POST");
      await page.getByRole("button", { name: round === 1 ? "Lưu bản nháp" : "Đăng sản phẩm" }).click();
      expect((await revalidated).status()).toBe(200);
      await expect(page).toHaveURL(/\/admin\/san-pham$/);
    }
    const created = (await savedProducts(page)).filter(p => p.name === "Tủ đa năng 4 tầng");
    expect(created.map(p => [p.slug, p.sku, p.price, p.category_id, p.publish_status])).toEqual([
      ["tu-da-nang-4-tang", "TN-TU-DA-NANG-4-TANG", "1250000", "c4", "draft"],
      ["tu-da-nang-4-tang-2", "TN-TU-DA-NANG-4-TANG-2", "1250000", "c4", "published"],
    ]);

    // A product that was never published may still change its URL, with a warning.
    await page.goto(`/admin/san-pham/${created[0].id}`);
    await expect(page.getByLabel("Loại sản phẩm")).toHaveValue("c4");
    await page.getByRole("button", { name: "Chỉnh sửa đường dẫn" }).click();
    await expect(page.getByText("Lưu ý: đổi đường dẫn sẽ đổi địa chỉ trang của sản phẩm này.")).toBeVisible();

    await page.goto("/san-pham/tu-da-nang-4-tang-2");
    await expect(page.getByRole("heading", { level: 1, name: "Tủ đa năng 4 tầng" })).toBeVisible();
  });

  test("P3. a typed URL or product code that is taken is reported at the field and the input is kept", async ({ page }) => {
    writesFixture();
    await newProductPage(page);
    await page.getByLabel("Tên sản phẩm").fill("Tủ thử trùng");
    await page.getByLabel("Mô tả", { exact: true }).fill("Mô tả không được mất");
    await page.getByRole("button", { name: "Chỉnh sửa đường dẫn" }).click();
    await page.getByLabel("Đường dẫn sản phẩm").fill("tu-5-tang");
    await page.getByRole("button", { name: "Lưu bản nháp" }).click();
    await expect(page.getByText("Đường dẫn này đã có sản phẩm khác dùng")).toBeVisible();
    await expect(page.getByLabel("Đường dẫn sản phẩm")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Tên sản phẩm")).toHaveValue("Tủ thử trùng");
    await expect(page.getByLabel("Mô tả", { exact: true })).toHaveValue("Mô tả không được mất");

    await page.getByLabel("Đường dẫn sản phẩm").fill("tu-thu-trung");
    await page.getByLabel("Mã sản phẩm (không bắt buộc)").fill("TN-5T-01");
    await page.getByRole("button", { name: "Lưu bản nháp" }).click();
    await expect(page.getByText("Mã sản phẩm này đã dùng cho sản phẩm khác")).toBeVisible();
    await page.getByLabel("Mã sản phẩm (không bắt buộc)").fill("TN-THU-001");
    await page.getByRole("button", { name: "Lưu bản nháp" }).click();
    await expect(page).toHaveURL(/\/admin\/san-pham$/);
    expect((await savedProducts(page)).find(p => p.slug === "tu-thu-trung")?.sku).toBe("TN-THU-001");
  });

  test("P5. generated values retry to -3 across slug and code conflicts; a failed cache refresh never saves twice", async ({ page }) => {
    writesFixture();
    const seed = (data: Record<string, string>) => page.request.post(`${mock}/api/v1/admin/products`, { data: { publish_status: "draft", images: [], ...data } });
    await seed({ name: "Tủ ba A", slug: "tu-ba", sku: "SEED-A" });
    await seed({ name: "Tủ ba B", slug: "tu-ba-2", sku: "SEED-B" });
    await seed({ name: "Khác", slug: "khac", sku: "TN-TU-BA-3" }); // the code generated for tu-ba-3 is taken too
    const creates: string[] = [];
    page.on("request", request => { if (request.method() === "POST" && /\/admin\/products$/.test(request.url())) creates.push(JSON.parse(request.postData() ?? "{}").slug); });

    await newProductPage(page);
    await page.getByLabel("Tên sản phẩm").fill("Tủ ba");
    await page.getByRole("button", { name: "Lưu bản nháp" }).click();
    await expect(page).toHaveURL(/\/admin\/san-pham$/);
    expect(creates).toEqual(["tu-ba", "tu-ba-2", "tu-ba-3", "tu-ba-3"]);
    const saved = (await savedProducts(page)).filter(p => p.name === "Tủ ba");
    expect(saved.map(p => [p.slug, p.sku])).toEqual([["tu-ba-3", "TN-TU-BA-3-4"]]);

    // The product is saved but the cache refresh fails: report it as saved, send the create once.
    creates.length = 0;
    await page.route("**/api/revalidate", route => route.fulfill({ status: 502, body: "Edge cache purge failed" }));
    await newProductPage(page);
    await page.getByLabel("Tên sản phẩm").fill("Tủ cache lỗi");
    await page.getByRole("button", { name: "Lưu bản nháp" }).click();
    await expect(page.getByText("Đã lưu. Trang web công khai sẽ tự cập nhật trong vòng 5 phút")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/san-pham$/);
    expect(creates).toEqual(["tu-cache-loi"]);
    expect((await savedProducts(page)).filter(p => p.name === "Tủ cache lỗi")).toHaveLength(1);
  });

  test("P6. a draft published by someone else meanwhile keeps its URL when a stale form changes it", async ({ page }) => {
    writesFixture();
    const draft = await (await page.request.post(`${mock}/api/v1/admin/products`, { data: { name: "Tủ nháp", slug: "tu-nhap", sku: "TU-NHAP", publish_status: "draft", images: [] } })).json();
    await page.goto(`/admin/san-pham/${draft.id}`);
    await page.getByRole("button", { name: "Chỉnh sửa đường dẫn" }).click();
    await page.request.patch(`${mock}/api/v1/admin/products/${draft.id}`, { data: { publish_status: "published" } }); // another admin
    await page.getByLabel("Đường dẫn sản phẩm").fill("tu-nhap-moi");
    await page.getByRole("button", { name: "Lưu bản nháp" }).click();
    await expect(page.getByText("Sản phẩm này đã được đăng nên giữ đường dẫn cũ.")).toBeVisible();
    await expect(page.locator("output")).toHaveText("/san-pham/tu-nhap");
    expect((await savedProducts(page)).find(p => p.id === draft.id)?.slug).toBe("tu-nhap");
  });

  test("P4. editing a published product keeps its URL and category; hiding removes it from the site", async ({ page }) => {
    writesFixture();
    await page.goto("/admin/san-pham/p1");
    await expect(page.getByLabel("Loại sản phẩm")).toHaveValue("c2");
    await page.getByLabel("Tên sản phẩm").fill("Tủ nhựa 5 tầng nắp trắng (mẫu mới)");
    await expect(page.locator("output")).toHaveText("/san-pham/tu-5-tang");
    await expect(page.getByRole("button", { name: "Chỉnh sửa đường dẫn" })).toHaveCount(0);
    await expect(page.getByText("Sản phẩm đã đăng nên giữ nguyên đường dẫn")).toBeVisible();
    await expect(page.getByRole("note")).toHaveCount(0); // already published: no first-publish warning
    await page.getByRole("button", { name: "Lưu thay đổi" }).click();
    await expect(page).toHaveURL(/\/admin\/san-pham$/);
    const saved = (await savedProducts(page)).find(p => p.id === "p1")!;
    expect([saved.name, saved.slug, saved.sku, saved.category_id]).toEqual(["Tủ nhựa 5 tầng nắp trắng (mẫu mới)", "tu-5-tang", "TN-5T-01", "c2"]);
    const detail = await page.goto("/san-pham/tu-5-tang");
    expect(detail?.status()).toBe(200);

    // Hidden products are not public (the fixture enforces visibility for "e2e-" records, like the API).
    await newProductPage(page);
    await page.getByLabel("Tên sản phẩm").fill("E2E tủ ẩn");
    await page.getByLabel("Loại sản phẩm").selectOption({ label: "Tủ quần áo" });
    await page.getByLabel("Trạng thái đăng bán").selectOption("published");
    await page.getByLabel("Hiển thị trên website").uncheck();
    await expect(page.getByText("Đã đăng nhưng đang ẩn: khách chưa thấy sản phẩm này.")).toBeVisible();
    await page.getByRole("button", { name: "Đăng sản phẩm" }).click();
    await expect(page).toHaveURL(/\/admin\/san-pham$/);
    await page.goto("/san-pham?category=tu-quan-ao");
    await expect(page.getByRole("heading", { level: 1, name: "Tủ quần áo" })).toBeVisible();
    await expect(page.getByText("E2E tủ ẩn")).toHaveCount(0);
    expect((await page.goto("/san-pham/e2e-tu-an"))?.status()).toBe(404);
  });
});

test.describe("product categories", () => {
  test.beforeEach(async ({ page }) => { await page.request.post(`${mock}/__reset`); await login(page); });
  test.afterAll(async ({ request }) => { await request.post(`${mock}/__reset`); });

  test("C1. create from a suggestion, reject duplicates, rename, reorder, hide and delete safely", async ({ page }) => {
    writesFixture();
    const dialogs: string[] = [];
    page.on("dialog", dialog => { dialogs.push(dialog.message()); void dialog.accept(); });
    await page.goto("/admin/danh-muc");
    await expect(page.getByRole("heading", { level: 1, name: "Loại sản phẩm" })).toBeVisible();
    const row = (name: string) => page.locator("li").filter({ has: page.getByText(name, { exact: true }) });
    await expect(row("Tủ quần áo")).toContainText("2 sản phẩm");

    await page.getByRole("button", { name: "Tủ đa năng", exact: true }).click();
    await expect(page.getByLabel("Tên loại")).toHaveValue("Tủ đa năng");
    await expect(page.getByText("Đường dẫn lọc: /san-pham?category=tu-da-nang")).toBeVisible();
    await page.getByRole("button", { name: "Thêm loại" }).click();
    await expect(row("Tủ đa năng")).toContainText("0 sản phẩm");
    await expect(page.getByRole("button", { name: "Tủ đa năng", exact: true })).toHaveCount(0); // suggestion used

    await page.getByLabel("Tên loại").fill("  tủ ĐA năng ");
    await page.getByRole("button", { name: "Thêm loại" }).click();
    await expect(page.getByText("Đã có loại “Tủ đa năng”")).toBeVisible();

    await page.getByRole("button", { name: "Sửa loại Tủ đa năng" }).click();
    const editor = page.locator("li form");
    await expect(editor.getByLabel("Tên loại")).toBeFocused();
    await editor.getByLabel("Tên loại").fill("Tủ đa năng nhiều ngăn");
    await editor.getByLabel("Mô tả ngắn").fill("Tủ dùng được cho nhiều phòng.");
    await page.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(row("Tủ đa năng nhiều ngăn")).toContainText("/san-pham?category=tu-da-nang"); // slug kept on rename

    const names = () => page.locator("li p.font-medium > span:first-child").allTextContents();
    await page.getByRole("button", { name: "Đưa Tủ đa năng nhiều ngăn lên trên" }).click();
    await expect.poll(async () => (await names()).slice(-2)).toEqual(["Tủ đa năng nhiều ngăn", "Đồ trẻ em"]);
    await page.goto("/san-pham");
    const tabs = page.getByRole("navigation", { name: "Loại sản phẩm" }).getByRole("link");
    await expect(tabs).toHaveText(["Tất cả sản phẩm", "Tủ quần áo", "Tủ ngăn kéo", "Tủ giày", "Kệ bếp", "Tủ đa năng nhiều ngăn", "Đồ trẻ em"]);
    await tabs.filter({ hasText: "Tủ đa năng nhiều ngăn" }).click();
    await expect(page).toHaveURL(/category=tu-da-nang$/);
    await expect(page.getByRole("heading", { name: "Chưa có sản phẩm nào trong “Tủ đa năng nhiều ngăn”" })).toBeVisible();

    await page.goto("/admin/danh-muc");
    await page.getByRole("button", { name: "Ẩn loại Tủ đa năng nhiều ngăn" }).click();
    expect(dialogs.at(-1)).toContain("0 sản phẩm thuộc loại này sẽ bị ẩn khỏi website");
    await expect(row("Tủ đa năng nhiều ngăn")).toContainText("Đang ẩn");
    await page.goto("/san-pham?category=tu-da-nang");
    await expect(page.getByRole("heading", { name: "Loại sản phẩm này hiện không còn hiển thị" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Loại sản phẩm" }).getByRole("link", { name: "Tủ đa năng nhiều ngăn" })).toHaveCount(0);

    // A category with products cannot be deleted: no confirm dialog, no request, a clear message.
    await page.goto("/admin/danh-muc");
    await page.getByRole("button", { name: "Xóa loại Tủ quần áo" }).click();
    await expect(page.getByText("“Tủ quần áo” đang có 2 sản phẩm.", { exact: false })).toBeVisible();
    expect(dialogs).toHaveLength(1); // only the hide confirmation so far
    await expect(row("Tủ quần áo")).toBeVisible();
    const guard = await page.request.delete(`${mock}/api/v1/admin/categories/c1`);
    expect([guard.status(), (await guard.json()).error.message]).toEqual([409, "Category has products"]);

    await page.getByRole("button", { name: "Xóa loại Tủ đa năng nhiều ngăn" }).click();
    await expect(page.getByText("Đã xóa loại “Tủ đa năng nhiều ngăn”")).toBeVisible();
    expect(dialogs).toHaveLength(2);
    await expect(row("Tủ đa năng nhiều ngăn")).toHaveCount(0);

    // The deleted category keeps its slug reserved in the database, so re-creating it gets the next free one.
    await page.getByLabel("Tên loại").fill("Tủ đa năng");
    await page.getByRole("button", { name: "Thêm loại" }).click();
    await expect(row("Tủ đa năng")).toContainText("/san-pham?category=tu-da-nang-2");
  });

  test("C3. hidden categories never filter public products, even when every category is hidden", async ({ page }) => {
    writesFixture();
    for (const id of ["c1", "c2", "c3", "c4", "c5"]) await page.request.patch(`${mock}/api/v1/admin/categories/${id}`, { data: { is_visible: false } });
    expect((await (await page.request.get(`${mock}/api/v1/products?category=tu-quan-ao`)).json()).total).toBe(0);
    await page.goto("/san-pham?category=tu-quan-ao");
    await expect(page.getByRole("heading", { name: "Loại sản phẩm này hiện không còn hiển thị" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Loại sản phẩm" })).toHaveCount(0);
    await expect(page.getByText("0 sản phẩm")).toBeVisible();

    // A product cannot be moved into a category deleted in another tab.
    const gone = await (await page.request.post(`${mock}/api/v1/admin/categories`, { data: { name: "Sắp xóa", slug: "sap-xoa" } })).json();
    await newProductPage(page);
    await page.getByLabel("Tên sản phẩm").fill("Tủ chọn loại cũ");
    await page.getByLabel("Loại sản phẩm").selectOption({ label: "Sắp xóa" });
    await page.request.delete(`${mock}/api/v1/admin/categories/${gone.id}`);
    await page.getByRole("button", { name: "Lưu bản nháp" }).click();
    await expect(page.getByText("Loại sản phẩm này vừa bị xóa. Hãy chọn loại khác.")).toBeVisible();
    await expect(page.getByLabel("Tên sản phẩm")).toHaveValue("Tủ chọn loại cũ");
  });

  test("C4. hiding a category hides its products everywhere public, keeps them in admin, and restores them", async ({ page }) => {
    writesFixture();
    const dialogs: string[] = [];
    page.on("dialog", dialog => { dialogs.push(dialog.message()); void dialog.accept(); });
    const publicHas = async (path: string, text: string) => (await (await page.request.get(path)).text()).includes(text);

    // Client-side navigation keeps the product list query warm: it must still show the change.
    await page.goto("/admin/san-pham");
    await expect(page.locator(".badge:visible", { hasText: "Loại đang ẩn" })).toHaveCount(0);
    const sidebar = page.getByRole("navigation", { name: "Quản trị" });
    await sidebar.getByRole("link", { name: "Loại sản phẩm" }).click();
    const revalidated = page.waitForResponse(response => response.url().endsWith("/api/revalidate") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Ẩn loại Tủ quần áo" }).click();
    expect(dialogs).toEqual([expect.stringContaining("2 sản phẩm thuộc loại này sẽ bị ẩn khỏi website")]);
    expect((await revalidated).status()).toBe(200); // purges the Workers Cache tag as for any admin change
    await expect(page.getByText("Đã ẩn “Tủ quần áo”")).toBeVisible();

    expect(await publicHas("/san-pham", "Tủ áo 3 cánh có gương")).toBe(false);
    expect(await publicHas("/san-pham?search=t%E1%BB%A7+%C3%A1o", "Tủ áo 3 cánh có gương")).toBe(false);
    expect((await page.request.get("/san-pham/tu-ao-3-canh")).status()).toBe(404);
    expect(await publicHas("/sitemap.xml", "/san-pham/tu-ao-3-canh")).toBe(false);
    expect(await publicHas("/sitemap.xml", "/san-pham/tu-5-tang")).toBe(true);

    await sidebar.getByRole("link", { name: "Sản phẩm", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/san-pham$/);
    await expect(page.locator(".badge:visible", { hasText: "Loại đang ẩn" }).first()).toBeVisible(); // table on desktop, cards on phones
    await page.goto("/admin/san-pham/p2");
    await expect(page.getByLabel("Loại sản phẩm")).toHaveValue("c1");
    await expect(page.getByText("Loại “Tủ quần áo” đang ẩn: khách chưa thấy sản phẩm này.")).toBeVisible();
    const stored = (await savedProducts(page)).find(p => p.id === "p2")!;
    expect([stored.publish_status, stored.is_visible]).toEqual(["published", true]);

    await page.goto("/admin/danh-muc");
    await page.getByRole("button", { name: "Hiện loại Tủ quần áo" }).click();
    await expect(page.getByText("Đã hiện “Tủ quần áo”")).toBeVisible();
    expect(dialogs).toHaveLength(1); // showing again needs no confirmation
    expect((await page.request.get("/san-pham/tu-ao-3-canh")).status()).toBe(200);
    expect(await publicHas("/san-pham?category=tu-quan-ao", "Tủ áo 3 cánh có gương")).toBe(true);
  });

  test("C2. the product form links to category management and shows hidden categories as such", async ({ page }) => {
    writesFixture();
    await page.request.patch(`${mock}/api/v1/admin/categories/c5`, { data: { is_visible: false } });
    await newProductPage(page);
    await expect(page.getByLabel("Loại sản phẩm").locator("option").first()).toHaveText("Chọn loại tủ");
    await expect(page.getByLabel("Loại sản phẩm").locator("option", { hasText: "Đồ trẻ em (đang ẩn)" })).toBeAttached();
    const manage = page.getByRole("link", { name: /Quản lý loại sản phẩm/ });
    await expect(manage).toHaveAttribute("href", "/admin/danh-muc");
    await expect(manage).toHaveAttribute("target", "_blank"); // the unsaved form stays open
  });
});

test("F1. category filter is shareable, survives reload and is touch friendly", async ({ page }) => {
  await page.goto("/san-pham");
  const nav = page.getByRole("navigation", { name: "Loại sản phẩm" });
  await expect(nav.getByRole("link", { name: "Tất cả sản phẩm" })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("link", { name: "Tủ quần áo" }).click();
  await expect(page).toHaveURL(/\/san-pham\?category=tu-quan-ao$/);
  await expect(page.getByRole("heading", { level: 1, name: "Tủ quần áo" })).toBeVisible();
  await expect(page.getByText("2 sản phẩm")).toBeVisible();
  await page.reload();
  await expect(nav.getByRole("link", { name: "Tủ quần áo" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/san-pham$/);
  if (isPhone(page)) {
    const box = await nav.getByRole("link", { name: "Tủ quần áo" }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await noOverflow(page);
});

test("F2. admin category management requires a session", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/admin/danh-muc");
  await expect(page).toHaveURL(/\/admin\/login/);
});
