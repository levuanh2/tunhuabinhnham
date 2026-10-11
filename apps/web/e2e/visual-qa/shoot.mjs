// Visual QA: full-page screenshots per viewport + overflow report. Needs the QA mock API and a server on :3100 (see e2e/responsive.spec.ts header).
// usage: node e2e/visual-qa/shoot.mjs <outDir> [baseUrl] [pagesCsv]   env: W=360,390 (widths), ADMIN=1 (admin pages via fake auth)
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const [out, base = "http://localhost:3100", only] = process.argv.slice(2);
const publicPages = { home: "/", products: "/san-pham", detail: "/san-pham/tu-5-tang", news: "/tin-tuc", article: "/tin-tuc/chon-tu-phong-ngu", contact: "/lien-he", about: "/gioi-thieu", login: "/admin/login", search: "/san-pham?search=zzz" };
const sizes = { 320: 568, 360: 800, 375: 812, 390: 844, 412: 915, 430: 932, 768: 1024, 1024: 768, 1440: 900 };
const widths = (process.env.W ?? Object.keys(sizes).join(",")).split(",").map(Number);
const admin = process.env.ADMIN === "1";
const pages = admin ? { "admin-dashboard": "/admin", "admin-products": "/admin/san-pham", "admin-editor": "/admin/san-pham/p1", "admin-new": "/admin/san-pham/moi", "admin-categories": "/admin/danh-muc", "admin-posts": "/admin/bai-viet", "admin-banners": "/admin/banner", "admin-settings": "/admin/cai-dat" } : publicPages;
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const report = [];
let storage;
if (admin) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await page.goto(base + "/admin/login"); await page.getByLabel("Email").fill("qa@example.test"); await page.getByLabel("Mật khẩu").fill("qa-password-123");
  await page.getByRole("button", { name: "Đăng nhập" }).click(); await page.waitForURL(/\/admin\/?$/, { timeout: 60000 });
  storage = await ctx.storageState(); await ctx.close();
}
for (const [name, path] of Object.entries(pages)) {
  if (only && !only.split(",").includes(name)) continue;
  for (const w of widths) {
    const ctx = await browser.newContext({ viewport: { width: w, height: sizes[w] ?? 900 }, storageState: storage, hasTouch: w < 768, isMobile: w < 768, deviceScaleFactor: 1 }); const page = await ctx.newPage();
    await page.goto(base + path, { waitUntil: "networkidle", timeout: 90000 });
    await page.evaluate(() => document.fonts.ready); if (admin) await page.waitForTimeout(400);
    const m = await page.evaluate(() => {
      const de = document.documentElement; const offenders = [];
      for (const el of document.querySelectorAll("body *")) { const r = el.getBoundingClientRect(); if (r.right > de.clientWidth + 1 && getComputedStyle(el).position !== "fixed") offenders.push(el.tagName + "." + String(el.className).slice(0, 40)); }
      return { scroll: de.scrollWidth, client: de.clientWidth, offenders: offenders.slice(0, 5), h1: [...document.querySelectorAll("h1")].map(h => h.textContent.trim()).slice(0, 2) };
    });
    report.push({ name, w, overflow: m.scroll > m.client, ...m });
    await page.screenshot({ path: `${out}/${name}-${w}.jpg`, fullPage: true, type: "jpeg", quality: 70 });
    await ctx.close();
  }
}
await browser.close();
fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
for (const r of report) if (r.overflow || r.h1.length !== 1) console.log(r.name, r.w, "overflow:", r.overflow, r.scroll, r.client, r.offenders.join(" "), "h1:", r.h1.length);
console.log("done", report.length);
