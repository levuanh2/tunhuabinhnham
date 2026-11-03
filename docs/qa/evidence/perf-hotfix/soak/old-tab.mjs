// Old-tab check: a tab opened on the previous version keeps working after the switch.
// The page loads from OLD (a version preview URL); every later request (assets, RSC, images) is sent to NEW.
// Usage: node old-tab.mjs <old origin> <new origin>. Read-only.
import { chromium, webkit, devices } from "playwright";

const [OLD, NEW] = process.argv.slice(2);
let failures = 0;
for (const [name, engine, ctx] of [["chromium", chromium, { viewport: { width: 1440, height: 900 } }], ["webkit-mobile", webkit, devices["iPhone 13"]]]) {
  const browser = await engine.launch(); const page = await (await browser.newContext(ctx)).newPage();
  const problems = []; let routed = 0, rsc = 0;
  try {
    await page.goto(OLD + "/san-pham", { waitUntil: "networkidle", timeout: 60000 });
    await page.route(u => u.origin === OLD, async route => { // after the first load everything goes to the new version
      const url = route.request().url().replace(OLD, NEW); routed++;
      if (route.request().headers().rsc) rsc++;
      try {
        const response = await route.fetch({ url, maxRedirects: 0 });
        const path = new URL(url).pathname, type = response.headers()["content-type"] ?? "";
        if (path.startsWith("/_next/static/") && (response.status() !== 200 || (path.endsWith(".css") && !type.startsWith("text/css")) || (path.endsWith(".js") && !type.includes("javascript"))))
          problems.push(`${response.status()} ${type} ${path}`);
        await route.fulfill({ response });
      } catch (e) { problems.push(`network ${String(e).split("\n")[0].slice(0, 80)}`); await route.abort(); }
    });
    const styled = () => page.evaluate(() => getComputedStyle(document.body).fontFamily.includes("Vietnam") && getComputedStyle(document.body).backgroundColor !== "rgba(0, 0, 0, 0)");
    const steps = [];
    const tabs = await page.locator('a[href^="/san-pham?category="]').evaluateAll(as => [...new Set(as.map(a => a.getAttribute("href")))]);
    for (const href of tabs.slice(0, 2)) { await page.locator(`a[href="${href}"]:visible`).first().click(); await page.waitForURL(u => u.pathname + u.search === href, { timeout: 30000 }); steps.push(`${href}:${await styled()}`); }
    // Some categories are empty: go back to "all products" by client navigation before opening a product.
    await page.locator(`a[href="/san-pham"]:visible`).first().click(); await page.waitForURL(u => u.pathname + u.search === "/san-pham", { timeout: 30000 }); steps.push(`/san-pham:${await styled()}`);
    const product = await page.locator('a[href^="/san-pham/"]').first().getAttribute("href");
    await page.locator(`a[href="${product}"]:visible`).first().click(); await page.waitForURL(u => u.pathname === product, { timeout: 30000 }); steps.push(`${product}:${await styled()}`);
    await page.goBack(); await page.waitForLoadState("networkidle"); steps.push(`back:${await styled()}`);
    const ok = problems.length === 0 && steps.every(s => s.endsWith(":true"));
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"} ${name} routed=${routed} rsc=${rsc} steps=${steps.join(" ")} problems=${JSON.stringify(problems.slice(0, 3))}`);
  } catch (e) { console.log(`UNVERIFIED ${name} ${String(e).split("\n")[0].slice(0, 120)}`); failures++; }
  await browser.close();
}
console.log(failures ? "OLD_TAB_NOT_PASS" : "OLD_TAB_PASS");
