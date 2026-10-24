import { expect, test, type Page } from "@playwright/test";

/*
 * Client navigation feedback (components/navigation-feedback.tsx) and the product page's related section.
 * Runs against the local QA fixture server only (see responsive.spec.ts for the setup).
 * The RSC response is held 1.5 s to stand for an uncached render on Render/Supabase.
 */
test.skip(process.env.E2E_MOCK_API !== "1", "Requires the local QA fixture API (E2E_MOCK_API=1)");

async function slowRsc(page: Page, ms = 1500) {
  await page.route(url => url.searchParams.has("_rsc"), async route => { await new Promise(r => setTimeout(r, ms)); await route.continue(); });
}
const pending = (page: Page) => page.evaluate(() => ({
  link: document.querySelector("a[data-nav-pending]")?.getAttribute("href") ?? null,
  busy: document.getElementById("noi-dung")?.getAttribute("aria-busy") ?? null,
  bar: document.querySelector(".nav-progress") ? Number(getComputedStyle(document.querySelector(".nav-progress")!).opacity) : null,
}));

test("N1. a slow navigation shows feedback at once and clears it when the page arrives; Back/Forward leave nothing behind", async ({ page }) => {
  // After hydration: a click before it is a plain browser navigation (the browser shows its own progress).
  await page.goto("/san-pham", { waitUntil: "networkidle" });
  const tab = page.locator('nav[aria-label="Loại sản phẩm"] a[href^="/san-pham?category="]').first();
  const href = (await tab.getAttribute("href"))!;
  await slowRsc(page);
  await tab.click();
  // immediately: the clicked tab dims and <main> is busy; the bar only after its 150 ms delay
  await expect.poll(() => pending(page), { timeout: 300 }).toMatchObject({ link: href, busy: "true" });
  await expect.poll(async () => (await pending(page)).bar, { timeout: 1000 }).toBe(1);
  await page.waitForURL(u => u.pathname + u.search === href);
  await expect.poll(() => pending(page)).toEqual({ link: null, busy: null, bar: null });
  await page.goBack();
  await page.waitForURL(u => u.search === "");
  expect(await pending(page)).toEqual({ link: null, busy: null, bar: null });
  await page.goForward();
  await page.waitForURL(u => u.pathname + u.search === href);
  await expect.poll(() => pending(page)).toEqual({ link: null, busy: null, bar: null });
});

test("N2. keyboard activation and the mobile menu get the same feedback; reduced motion keeps a static bar", async ({ page, isMobile }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "networkidle" });
  await slowRsc(page);
  if (isMobile) {
    await page.getByRole("button", { name: "Mở menu" }).click();
    await page.locator('[aria-label="Menu di động"] a[href="/tin-tuc"]').click();
  } else {
    await page.locator('nav[aria-label="Điều hướng chính"] a[href="/tin-tuc"]').focus();
    await page.keyboard.press("Enter");
  }
  await expect.poll(async () => (await pending(page)).bar, { timeout: 1000 }).toBe(1);
  const motion = await page.evaluate(() => getComputedStyle(document.querySelector(".nav-progress")!).animationDuration);
  expect(motion.split(",").every(d => parseFloat(d) < 0.001), `reduced motion: ${motion}`).toBe(true);
  await page.waitForURL("**/tin-tuc");
  await expect.poll(() => pending(page)).toEqual({ link: null, busy: null, bar: null });
});

test("N3. product page: related products are in the server HTML, same category only, without the product itself", async ({ request }) => {
  const list = await (await request.get("/san-pham")).text();
  const slugs = [...new Set([...list.matchAll(/href="\/san-pham\/([^"?#]+)"/g)].map(m => m[1]!))];
  let checked = 0;
  for (const slug of slugs) {
    const html = await (await request.get(`/san-pham/${slug}`)).text();
    if (!html.includes("Sản phẩm cùng loại")) continue; // its category has no other public product
    const section = html.split("Sản phẩm cùng loại")[1]!.split("<footer")[0]!;
    expect(section, slug).not.toContain(`href="/san-pham/${slug}"`);
    expect(section, slug).toMatch(/href="\/san-pham\/[^"?#]+"/);
    checked++;
  }
  expect(checked, "at least one product with related products").toBeGreaterThan(0);
});
