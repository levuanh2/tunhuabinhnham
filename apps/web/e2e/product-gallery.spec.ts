import { expect, test, type Page } from "@playwright/test";

/*
 * Product detail gallery. Fixture API only (e2e/fixtures/mock-api.mjs); the image set of one product is
 * rewritten per test through the fixture's admin PATCH and reset afterwards (desktop project only).
 * Regression for: a product with ONE image rendered it in the 72px thumbnail column (72x90 on desktop).
 */
test.skip(process.env.E2E_MOCK_API !== "1", "Requires the local QA fixture API (E2E_MOCK_API=1)");

const mock = process.env.E2E_MOCK_API_URL ?? "http://127.0.0.1:8100";
const SVG = (fill: string, w = 900, h = 1125) => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${fill}"/></svg>`).toString("base64")}`;
// A realistic size: with srcset the browser divides by the density it requested (e.g. w=1920 at DPR 2), so a
// 1x1 body would end up with naturalWidth 0 in WebKit even though it loaded.
const SLOW_IMAGE = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="2400"><rect width="1920" height="2400" fill="#d8c9b6"/></svg>');
const image = (key: string, url: string, i: number) => ({ storage_key: key, url, alt_text: "", sort_order: i, is_primary: i === 0 });

async function setImages(page: Page, images: ReturnType<typeof image>[]) {
  const response = await page.request.patch(`${mock}/api/v1/admin/products/p3`, { data: { images } });
  expect(response.ok()).toBe(true);
}
const gallery = (page: Page) => page.getByRole("region", { name: /^Ảnh / });
const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;
async function noOverflow(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll, "page must not scroll horizontally").toBeLessThanOrEqual(client);
}

test.describe("product gallery", () => {
  test.beforeEach(() => test.skip(test.info().project.name !== "desktop", "rewrites a fixture product; viewports are set per test"));
  test.beforeEach(async ({ page }) => { await page.request.post(`${mock}/__reset`); });
  test.afterAll(async ({ request }) => { await request.post(`${mock}/__reset`); });

  test("G1. a single image fills the gallery column at every width (was 72x90)", async ({ page }) => {
    await setImages(page, [image("only", SVG("#d8c9b6", 960, 1280), 0)]);
    for (const [width, height] of [[1920, 1080], [1440, 900], [768, 1024], [390, 844], [375, 812]]) {
      await page.setViewportSize({ width, height });
      await page.goto("/san-pham/tu-giay");
      const region = (await gallery(page).boundingBox())!;
      // Structure-agnostic: the first <img> of the gallery is the main image (old and new markup).
      const main = await box(page, '[aria-roledescription="thư viện ảnh"] img');
      expect(main.width, `${width}px: main image uses the gallery width`).toBeGreaterThan(region.width * 0.98);
      expect(main.height / main.width, `${width}px: 4:5 frame`).toBeCloseTo(1.25, 1);
      if (width >= 1024) expect(main.width, `${width}px: large on desktop`).toBeGreaterThan(450);
      await expect(page.getByRole("list", { name: "Chọn ảnh" })).toHaveCount(0); // no thumbnails for one image
      await expect(gallery(page).locator("img")).toHaveAttribute("alt", "Tủ giày 4 tầng cửa lật"); // empty alt_text falls back to the name
      await expect(gallery(page).locator("img")).toHaveCSS("object-fit", "contain");
      await noOverflow(page);
    }
  });

  test("G2. several images: thumbnails below, selection, swipe track, lightbox with keyboard", async ({ page }) => {
    await setImages(page, [image("a", SVG("#d8c9b6"), 0), image("b", SVG("#c9d8c6", 1200, 800), 1), image("c", SVG("#c6cfd8", 600, 1200), 2)]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/san-pham/tu-giay");
    const main = await box(page, '[aria-roledescription="thư viện ảnh"] button[aria-label^="Phóng to"]');
    const thumbs = (await page.getByRole("list", { name: "Chọn ảnh" }).boundingBox())!;
    expect(thumbs.y, "thumbnails sit below the main image").toBeGreaterThanOrEqual(main.y + main.height);

    const second = page.getByRole("button", { name: "Xem ảnh 2 trên 3" });
    await second.click();
    await expect(second).toHaveAttribute("aria-pressed", "true");
    await expect(gallery(page).getByText("2/3")).toBeVisible();

    // Keyboard: arrows on the track, Enter on the main image opens the lightbox, arrows move, Escape closes.
    await page.locator('[aria-label="Vuốt hoặc dùng phím mũi tên để xem ảnh"]').focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("button", { name: "Xem ảnh 3 trên 3" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Phóng to ảnh 3 trên 3" }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: /^Ảnh phóng to/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Đóng ảnh phóng to" })).toBeFocused();
    await expect(dialog.getByText("3/3")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByText("1/3")).toBeVisible(); // wraps around
    await dialog.getByRole("button", { name: "Ảnh sau" }).click();
    await expect(dialog.getByText("2/3")).toBeVisible();
    const zoomed = (await dialog.locator("img").boundingBox())!;
    expect(zoomed.width, "lightbox image is larger than the inline one").toBeGreaterThan(main.width);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Xem ảnh 2 trên 3" })).toHaveAttribute("aria-pressed", "true"); // in sync after closing
    // Opened from image 3, closed on image 2: focus goes to the visible slide, not the now-hidden opener.
    await expect(page.getByRole("button", { name: "Phóng to ảnh 2 trên 3" })).toBeFocused();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/san-pham/tu-giay");
    const list = page.getByRole("list", { name: "Chọn ảnh" });
    await expect(list).toHaveCSS("overflow-x", "auto"); // thumbnails scroll horizontally on phones
    await page.getByRole("button", { name: "Phóng to ảnh 1 trên 3" }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Đóng ảnh phóng to" }).click();
    await expect(dialog).toBeHidden();
    await noOverflow(page);
  });

  test("G3. broken and missing images show a clear state; the frame is reserved before images load", async ({ page }) => {
    await setImages(page, [image("ok", SVG("#d8c9b6"), 0), image("broken", "data:image/png;base64,AAAA", 1)]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/san-pham/tu-giay");
    await page.getByRole("button", { name: "Xem ảnh 2 trên 2" }).click();
    await expect(gallery(page).getByText("Không tải được ảnh")).toBeVisible();

    await setImages(page, []);
    await page.goto("/san-pham/tu-giay");
    await expect(page.getByText("Chưa có ảnh sản phẩm")).toBeVisible();

    // No layout shift: the 4:5 frame exists while the image bytes are still held back, and keeps its size after.
    await setImages(page, [image("slow", "https://fixture.supabase.co/storage/v1/object/public/product-images/slow.jpg", 0)]);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/_next/image?**", async route => { await held; await route.fulfill({ contentType: "image/svg+xml", body: SLOW_IMAGE }); });
    await page.goto("/san-pham/tu-giay", { waitUntil: "domcontentloaded" }); // "load" would wait for the held image
    const frame = page.locator('[aria-roledescription="thư viện ảnh"] [data-slide="0"]');
    const before = (await frame.boundingBox())!;
    expect(await page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>('[aria-roledescription="thư viện ảnh"] img')].every(img => !img.complete || img.naturalWidth === 0)), "image still pending").toBe(true);
    expect(before.height / before.width, "4:5 frame reserved before the image arrives").toBeCloseTo(1.25, 1);
    release();
    await expect.poll(() => page.evaluate(() => document.querySelector<HTMLImageElement>('[aria-roledescription="thư viện ảnh"] img')?.naturalWidth ?? 0)).toBeGreaterThan(0);
    const after = (await frame.boundingBox())!;
    expect([after.width, after.height]).toEqual([before.width, before.height]);
    const shift = await page.evaluate(() => new Promise<number>(resolve => {
      let total = 0;
      new PerformanceObserver(list => { for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!entry.hadRecentInput) total += entry.value; })
        .observe({ type: "layout-shift", buffered: true });
      setTimeout(() => resolve(total), 1000);
    }));
    expect(shift, "cumulative layout shift").toBeLessThan(0.1);
  });
});
