// Visual QA: interaction-state screenshots (menu, filter sheet, sticky CTA, admin drawer, validation). Same setup as shoot.mjs.
// usage: node shoot-states.mjs <outDir> [engine=chromium|webkit]
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const pw = require("@playwright/test");
const [out, engine = "chromium"] = process.argv.slice(2);
const base = "http://localhost:3100";
fs.mkdirSync(out, { recursive: true });
const browser = await pw[engine].launch();
const mobile = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: engine === "chromium", deviceScaleFactor: 1 };
const log = [];
async function shot(name, fn, opts = mobile) {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage();
  try { await fn(page, ctx); await page.screenshot({ path: `${out}/${name}${engine === "webkit" ? "-webkit" : ""}.jpg`, type: "jpeg", quality: 75 }); log.push(`${name}: ok`); }
  catch (e) { log.push(`${name}: FAIL ${e.message.split("\n")[0]}`); }
  await ctx.close();
}
await shot("state-mobile-menu-open", async page => {
  await page.goto(base + "/"); await page.getByRole("button", { name: "Mở menu" }).click();
  await page.getByRole("dialog", { name: "Menu" }).waitFor();
  const locked = await page.evaluate(() => getComputedStyle(document.documentElement).overflow); log.push(`  scroll lock: ${locked}`);
});
await shot("state-search-focus", async page => {
  await page.goto(base + "/"); await page.getByRole("button", { name: "Tìm sản phẩm" }).click();
  await page.waitForTimeout(200); log.push(`  focused: ${await page.evaluate(() => document.activeElement?.getAttribute("name"))}`);
});
await shot("state-filter-sheet-open", async page => {
  await page.goto(base + "/san-pham"); await page.getByRole("button", { name: /^Lọc/ }).click();
  await page.getByRole("dialog", { name: "Lọc và sắp xếp" }).waitFor(); await page.waitForTimeout(250);
});
await shot("state-sticky-cta", async page => {
  await page.goto(base + "/san-pham/tu-5-tang"); await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2)); await page.waitForTimeout(800);
  log.push(`  sticky visible: ${await page.evaluate(() => document.querySelector("[inert]") === null)}`);
});
await shot("state-login-validation", async page => {
  await page.goto(base + "/admin/login"); await page.getByRole("button", { name: "Đăng nhập" }).click(); await page.getByText("Email không hợp lệ").waitFor();
});
await shot("state-login-wrong-password", async page => {
  await page.goto(base + "/admin/login"); await page.getByLabel("Email").fill("qa@example.test"); await page.getByLabel("Mật khẩu").fill("wrong-password");
  await page.getByRole("button", { name: "Đăng nhập" }).click(); await page.getByRole("alert").waitFor();
});
async function login(page) {
  await page.goto(base + "/admin/login"); await page.getByLabel("Email").fill("qa@example.test"); await page.getByLabel("Mật khẩu").fill("qa-password-123");
  await page.getByRole("button", { name: "Đăng nhập" }).click(); await page.waitForURL(/\/admin\/?$/, { timeout: 60000 });
}
await shot("state-admin-drawer-open", async page => {
  await login(page); await page.getByRole("button", { name: "Mở menu quản trị" }).click(); await page.getByRole("dialog", { name: "Menu quản trị" }).waitFor(); await page.waitForTimeout(200);
});
await shot("state-admin-editor-validation", async page => {
  await login(page); await page.goto(base + "/admin/san-pham/moi"); await page.getByRole("button", { name: "Lưu sản phẩm" }).click();
  await page.getByText("Nhập tên sản phẩm").waitFor(); await page.getByLabel("Tên sản phẩm").scrollIntoViewIfNeeded();
});
await shot("state-admin-editor-category", async page => {
  await login(page); await page.goto(base + "/admin/san-pham/p1"); await page.getByLabel("Danh mục").waitFor(); await page.waitForTimeout(800);
  log.push(`  category select: ${await page.getByLabel("Danh mục").evaluate(el => el.options[el.selectedIndex].text)}`);
});
await shot("state-admin-save-blocked-feedback", async page => {
  await login(page); await page.goto(base + "/admin/cai-dat"); await page.getByRole("button", { name: "Lưu thay đổi" }).click(); await page.waitForTimeout(1200);
});
await browser.close();
console.log(log.join("\n"));
