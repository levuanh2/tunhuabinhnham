import { expect, test } from "@playwright/test";

test("public navigation is usable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Xem sản phẩm" }).click();
  await expect(page).toHaveURL(/san-pham/);
});

test("mobile page does not overflow", async ({ page }) => {
  await page.goto("/");
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
});
