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

test("11. Vietnamese text renders in the real web fonts, not a Georgia/system fallback", async ({ page }) => {
  await page.goto("/");
  const samples = ["Tủ Nhựa Bình Nhâm", "Nguyễn", "cầu", "về", "Chất lượng", "Tủ nhựa gia đình"];
  const result = await page.evaluate(async (texts) => {
    const probe = (cls: string) => { const el = document.createElement("p"); el.className = cls; el.textContent = texts.join(" "); document.body.append(el); return el; };
    const display = probe("display"), body = probe("");
    await document.fonts.ready;
    const first = (el: Element) => getComputedStyle(el).fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, "");
    const families = { display: first(display), body: first(body) };
    // Load the faces covering each sample, then compare rendered glyph pixels against Georgia/Arial.
    // (Advance widths are not a valid signal: next/font tunes metrics so fallbacks match the web font.)
    const canvas = document.createElement("canvas"); canvas.width = 900; canvas.height = 80;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const pixels = (font: string, text: string) => { ctx.clearRect(0, 0, 900, 80); ctx.font = font; ctx.fillText(text, 4, 56); return ctx.getImageData(0, 0, 900, 80).data.join(""); };
    const rows = [];
    for (const text of texts) {
      await document.fonts.load(`500 40px "${families.display}"`, text);
      await document.fonts.load(`400 40px "${families.body}"`, text);
      rows.push({ text,
        displayLoaded: document.fonts.check(`500 40px "${families.display}"`, text), bodyLoaded: document.fonts.check(`400 40px "${families.body}"`, text),
        differsFromGeorgia: pixels(`500 40px "${families.display}"`, text) !== pixels("500 40px Georgia", text),
        differsFromArial: pixels(`400 40px "${families.body}"`, text) !== pixels("400 40px Arial", text) });
    }
    display.remove(); body.remove();
    return { families, rows };
  }, samples);
  expect(result.families.display).toMatch(/Newsreader/);
  expect(result.families.body).toMatch(/Be_Vietnam_Pro|Be Vietnam Pro/);
  for (const row of result.rows) expect(row, row.text).toEqual({ text: row.text, displayLoaded: true, bodyLoaded: true, differsFromGeorgia: true, differsFromArial: true });
});

test("12. saving one field keeps category and persists image order after reload (fixture round-trip)", async ({ page, request }) => {
  test.skip(test.info().project.name !== "desktop", "mutates shared fixture state; run once");
  const mock = process.env.E2E_MOCK_API_URL ?? "http://127.0.0.1:8100";
  await request.post(`${mock}/__reset`);
  try {
    await login(page);
    await page.goto("/admin/san-pham/p1");
    await expect(page.getByLabel("Danh mục")).toHaveValue("c2");
    await page.getByLabel("Mô tả", { exact: true }).fill("Mô tả cập nhật bởi kiểm thử giao diện.");
    await page.getByRole("button", { name: "Đưa ảnh 1 ra sau" }).click();
    await page.getByRole("button", { name: "Lưu sản phẩm" }).click();
    await expect(page).toHaveURL(/\/admin\/san-pham$/);
    const saved = await (await request.get(`${mock}/api/v1/admin/products/p1`)).json();
    expect(saved.category_id).toBe("c2");
    expect(saved.images.map((i: { storage_key: string; sort_order: number }) => [i.storage_key, i.sort_order])).toEqual([["tu-ngan-keo", 0], ["tu-5-tang", 1], ["hop-dung-do", 2]]);
    expect(saved.images.find((i: { is_primary: boolean }) => i.is_primary).storage_key).toBe("tu-5-tang");
    await page.goto("/admin/san-pham/p1");
    await expect(page.getByLabel("Danh mục")).toHaveValue("c2");
    await expect(page.getByLabel("Mô tả", { exact: true })).toHaveValue("Mô tả cập nhật bởi kiểm thử giao diện.");
  } finally {
    await request.post(`${mock}/__reset`);
  }
});

test("13. login shows a Vietnamese inline error for wrong credentials", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill("qa@example.test");
  await page.getByLabel("Mật khẩu").fill("wrong-password");
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.locator("p[role=alert]")).toHaveText("Email hoặc mật khẩu không đúng.");
  await expect(page).toHaveURL(/\/admin\/login/);
});

test("14. browser title and og:site_name follow the CMS store name", async ({ page, request }) => {
  const api = process.env.E2E_API_URL ?? "http://localhost:8100/api/v1";
  const name = (await (await request.get(`${api}/site-settings`)).json()).store_name as string;
  await page.goto("/");
  await expect(page).toHaveTitle(name);
  await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute("content", name);
  await page.goto("/san-pham");
  await expect(page).toHaveTitle(`Sản phẩm | ${name}`);
});

test("15. saving the store name in Admin → Cài đặt updates public pages and admin chrome at once", async ({ page, request }) => {
  test.skip(test.info().project.name !== "desktop" || process.env.MOCK_WRITABLE_SETTINGS !== "1", "mutates shared fixture settings; needs MOCK_WRITABLE_SETTINGS=1");
  const mock = process.env.E2E_MOCK_API_URL ?? "http://127.0.0.1:8100";
  const renamed = "Cửa Hàng Kiểm Thử";
  await request.post(`${mock}/__reset`);
  try {
    await page.goto("/");
    const original = await page.title();
    await login(page);
    await page.goto("/admin/cai-dat");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Tên cửa hàng").fill(renamed);
    await page.getByRole("button", { name: /Lưu/ }).click();
    await expect(page.getByText(/Đã lưu/)).toBeVisible();
    for (const [path, title] of [["/", renamed], ["/san-pham", `Sản phẩm | ${renamed}`], ["/tin-tuc", `Tin tức | ${renamed}`]]) {
      await page.goto(path);
      await expect(page).toHaveTitle(title);
      await expect(page.locator("header").first()).toContainText(renamed);
      await expect(page.locator("footer").first()).toContainText(renamed);
    }
    await page.goto("/admin");
    await expect(page.locator("aside").first()).toContainText(renamed);
    await expect(page).toHaveTitle(`Quản trị · ${renamed}`);
    expect(original).not.toBe(renamed);
  } finally {
    // __reset bypasses the CMS, so invalidate the Data Cache the same way an admin save does.
    await request.post(`${mock}/__reset`);
    const token = (await (await request.post(`${mock}/auth/v1/token?grant_type=password`, { data: { email: "qa@example.test", password: "qa-password-123" } })).json()).access_token;
    expect((await request.post("/api/revalidate", { headers: { Authorization: `Bearer ${token}` } })).ok()).toBe(true);
  }
});

test("16. product and article pages expose title, description, canonical and Open Graph with the CMS store name", async ({ page, request }) => {
  const api = process.env.E2E_API_URL ?? "http://localhost:8100/api/v1";
  const store = (await (await request.get(`${api}/site-settings`)).json()).store_name as string;
  for (const [path, apiPath, type] of [["/san-pham/tu-5-tang", "/products/tu-5-tang", "website"], ["/tin-tuc/chon-tu-phong-ngu", "/posts/chon-tu-phong-ngu", "article"]]) {
    const item = await (await request.get(`${api}${apiPath}`)).json();
    const name = (item.name ?? item.title) as string;
    await page.goto(path);
    await expect(page).toHaveTitle(`${name} | ${store}`);
    const meta = (sel: string) => page.locator(sel).first();
    await expect(meta('meta[property="og:site_name"]')).toHaveAttribute("content", store);
    await expect(meta('meta[property="og:title"]')).toHaveAttribute("content", name);
    await expect(meta('meta[property="og:type"]')).toHaveAttribute("content", type);
    await expect(meta('meta[property="og:url"]')).toHaveAttribute("content", new RegExp(`${path}$`));
    await expect(meta('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`${path}$`));
    await expect(meta('meta[name="description"]')).toHaveAttribute("content", /\S/);
  }
});

test("17. logout redirects, Back does not reopen admin, and replayed pre-logout cookies are rejected", async ({ page, browser, baseURL }) => {
  test.skip(test.info().project.name !== "desktop", "one browser is enough for the fixture; the live spec covers WebKit");
  await login(page);
  await page.goto("/admin/san-pham");
  await page.goto("/admin/bai-viet");
  const authCookies = (await page.context().cookies()).filter(c => c.name.startsWith("sb-") && c.name.includes("auth-token"));
  expect(authCookies.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Đăng xuất" }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  expect((await page.context().cookies()).filter(c => c.name.startsWith("sb-") && c.name.includes("auth-token") && c.value)).toHaveLength(0);
  await page.goBack();
  await expect(page).not.toHaveURL(/\/admin\/(san-pham|bai-viet)$/);
  const replay = await browser.newContext({ baseURL });
  await replay.addCookies(authCookies);
  const replayPage = await replay.newPage();
  await replayPage.goto("/admin/san-pham");
  await expect(replayPage).toHaveURL(/\/admin\/login/);
  await replay.close();
});

/* Edge cache (worker.ts + src/lib/edge-cache.ts). The Workers Cache key ignores cookies, Authorization and
   the host, so every response that is not anonymous public HTML must keep private/no-store. */
const isPublic = (cc: string | null) => /\bpublic\b/.test(cc ?? "") && /s-maxage=\d+/.test(cc ?? "");

test("18. only anonymous public HTML is edge-cacheable; admin, API, RSC and redirects stay private", async ({ request, baseURL }) => {
  test.skip(test.info().project.name !== "desktop", "header contract, one browser is enough");
  for (const path of ["/", "/san-pham", "/san-pham?category=tu-quan-ao", "/san-pham/tu-5-tang", "/tin-tuc", "/tin-tuc/chon-tu-phong-ngu", "/lien-he", "/gioi-thieu"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(isPublic(response.headers()["cache-control"]), path).toBe(true);
    expect(response.headers()["cache-tag"], path).toBe("public-html");
    expect(response.headers()["vary"], path).toMatch(/rsc/);
    expect(response.headers()["set-cookie"], path).toBeUndefined();
  }
  const privatePaths: [string, Record<string, string>][] = [
    ["/admin", {}], ["/admin/san-pham", {}], ["/admin/login", {}], ["/san-pham/khong-ton-tai", {}],
    ["/?_rsc=1", { rsc: "1" }], ["/san-pham", { rsc: "1", "next-router-prefetch": "1" }],
    ["/", { cookie: "sb-127-auth-token=base64-eyJ" }], ["/", { authorization: "Bearer a.b.c" }],
  ];
  for (const [path, headers] of privatePaths) {
    const response = await request.get(path, { headers, maxRedirects: 0 });
    expect(isPublic(response.headers()["cache-control"] ?? null), `${path} ${JSON.stringify(headers)}`).toBe(false);
    expect(response.headers()["cache-tag"], path).toBeUndefined();
  }
  const logout = await request.post("/api/auth/logout", { headers: { origin: new URL(baseURL!).origin } });
  expect(isPublic(logout.headers()["cache-control"] ?? null)).toBe(false);
});

test("19. signed-in admin pages, admin data and logout are never edge-cacheable", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "header contract, one browser is enough");
  const seen: string[] = [];
  page.on("response", response => {
    const url = new URL(response.url());
    if (url.port === "8787" && (url.pathname.startsWith("/admin") || url.pathname.startsWith("/api/"))) {
      if (isPublic(response.headers()["cache-control"] ?? null) || response.headers()["cache-tag"]) seen.push(`${response.status()} ${url.pathname}${url.search}`);
    }
  });
  await login(page);
  for (const path of ["/admin", "/admin/san-pham", "/admin/cai-dat", "/admin/bai-viet"]) await page.goto(path);
  // A public page visited with the session cookie is rendered but not stored for others.
  const withSession = await page.request.get("/");
  expect(isPublic(withSession.headers()["cache-control"])).toBe(false);
  await page.getByRole("button", { name: "Đăng xuất" }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  expect(seen).toEqual([]);
  // After logout an anonymous context gets the redirect, not a cached admin page.
  const anonymous = await page.context().browser()!.newContext({ baseURL: new URL(page.url()).origin });
  const anonPage = await anonymous.newPage();
  await anonPage.goto("/admin/san-pham");
  await expect(anonPage).toHaveURL(/\/admin\/login/);
  await anonymous.close();
});

test("20. a page rendered while the API is failing is served but never marked cacheable", async ({ request }) => {
  test.skip(test.info().project.name !== "desktop", "mutates the shared fixture outage switch");
  const mock = process.env.E2E_MOCK_API_URL ?? "http://127.0.0.1:8100";
  try {
    await request.post(`${mock}/__outage?on=1`);
    for (const path of ["/", "/san-pham", "/tin-tuc"]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200); // degraded page still served (C2 behaviour)
      expect(isPublic(response.headers()["cache-control"]), path).toBe(false);
    }
  } finally {
    await request.post(`${mock}/__outage?on=0`);
  }
  expect(isPublic((await request.get("/")).headers()["cache-control"])).toBe(true);
});

test("21. real router prefetches of public pages are edge-cacheable; forged _rsc is not", async ({ page, request }) => {
  test.skip(test.info().project.name !== "desktop", "header contract, one browser is enough");
  const prefetches: { path: string; status: number; cc: string | null; type: string | null }[] = [];
  page.on("response", response => {
    const url = new URL(response.url());
    if (url.searchParams.has("_rsc") && !url.pathname.startsWith("/admin")) prefetches.push({ path: url.pathname, status: response.status(), cc: response.headers()["cache-control"] ?? null, type: response.headers()["content-type"] ?? null });
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const ok = prefetches.filter(p => p.status === 200);
  expect(ok.length).toBeGreaterThan(0);
  for (const p of ok) {
    expect(p.type, p.path).toMatch(/text\/x-component/);
    expect(isPublic(p.cc), p.path).toBe(true);
  }
  const forged = await request.get("/san-pham?_rsc=forged", { headers: { rsc: "1", "next-router-prefetch": "1" }, maxRedirects: 0 });
  expect(isPublic(forged.headers()["cache-control"] ?? null)).toBe(false);
});
