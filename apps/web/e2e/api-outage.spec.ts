import { expect, test } from "@playwright/test";

/*
 * Regression: an API failure must never look like an empty catalogue (2026-11 Render 429 outages).
 * The QA fixture fails only requests whose URL carries an "e2e-fail-*" marker, so these tests are parallel-safe.
 * Each URL is unique so Next's data cache cannot answer from an earlier successful fetch.
 */
test.skip(process.env.E2E_MOCK_API !== "1", "Requires the local QA fixture API (E2E_MOCK_API=1)");

const ERROR = "Chưa tải được dữ liệu";
const EMPTY = /Chưa có sản phẩm|Không có sản phẩm/;
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// "hang": the fixture never answers; API_TIMEOUT_MS (5 s in CI via .dev.vars, 60 s default) must end the request.
for (const kind of ["429", "500", "reset", "hang"] as const) {
  test(`product list: API ${kind} shows the error state, not "no products"`, async ({ page }) => {
    const response = await page.goto(`/san-pham?search=e2e-fail-${kind}-${unique()}`);
    expect(response?.status()).toBe(500);
    // The error page must never reach the edge cache (it would replace the last good copy for every visitor).
    expect(response?.headers()["cache-control"]).toBe("private, no-store, max-age=0");
    expect(response?.headers()["cloudflare-cdn-cache-control"]).toBeUndefined();
    await expect(page.getByRole("heading", { name: ERROR })).toBeVisible();
    await expect(page.getByText(EMPTY)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Thử lại" })).toBeVisible();
  });

  test(`product detail: API ${kind} shows the error state, not a 404`, async ({ page }) => {
    const response = await page.goto(`/san-pham/e2e-fail-${kind}-${unique()}`);
    expect(response?.status()).toBe(500);
    await expect(page.getByRole("heading", { name: ERROR })).toBeVisible();
    await expect(page.getByText("Không tìm thấy trang")).toHaveCount(0);
  });
}

test("a successful empty result is still shown as empty, not as an error", async ({ page }) => {
  const response = await page.goto(`/san-pham?search=e2e-empty-${unique()}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Không có sản phẩm phù hợp" })).toBeVisible();
  await expect(page.getByText(ERROR)).toHaveCount(0);
});

test("an unknown product is still a 404 when the API answers", async ({ page }) => {
  const response = await page.goto(`/san-pham/e2e-missing-${unique()}`);
  expect(response?.status()).toBe(404);
  await expect(page.getByText("Không tìm thấy trang")).toBeVisible();
});

test("the product list recovers on the next request once the API answers again", async ({ page }) => {
  // The fixture fails only the first request carrying this marker and ignores unknown sort values (sort is forwarded).
  const url = `/san-pham?sort=e2e-flaky-${unique()}`;
  expect((await page.goto(url))?.status()).toBe(500);
  await expect(page.getByRole("heading", { name: ERROR })).toBeVisible();
  expect((await page.goto(url))?.status()).toBe(200);
  await expect(page.locator('a[href^="/san-pham/"]').first()).toBeVisible();
  await expect(page.getByText(ERROR)).toHaveCount(0);
});
