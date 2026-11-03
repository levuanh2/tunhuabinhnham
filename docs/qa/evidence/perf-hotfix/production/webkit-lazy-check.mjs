// For each image WebKit reports as not loaded: is it lazy/off-screen/hidden, and does it load once scrolled into view?
// Usage: node webkit-lazy-check.mjs <origin> <path>...  Read-only.
import { webkit, devices } from "playwright";
const [origin, ...paths] = process.argv.slice(2);
let failures = 0;
for (const [name, ctx] of [["webkit", { viewport: { width: 1440, height: 900 } }], ["webkit-mobile", devices["iPhone 13"]]]) {
  const browser = await webkit.launch(); const page = await (await browser.newContext(ctx)).newPage();
  for (const path of paths) {
    await page.goto(origin + path, { waitUntil: "networkidle", timeout: 60000 });
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } scrollTo(0, 0); });
    await page.waitForLoadState("networkidle");
    const pending = await page.evaluate(() => [...document.images].map((img, i) => ({ i, img })).filter(({ img }) => !(img.complete && img.naturalWidth > 0)).map(({ i, img }) => {
      const r = img.getBoundingClientRect();
      return { i, loading: img.loading, hidden: !!img.closest('[aria-hidden="true"]'), inViewportX: r.right > 0 && r.left < innerWidth, w: Math.round(r.width) };
    }));
    const after = [];
    for (const p of pending) { // bring each one into view the way a swipe would, then wait for it
      const ok = await page.evaluate(async i => { const img = document.images[i]; img.scrollIntoView({ block: "center", inline: "center" });
        img.loading = "eager"; for (let t = 0; t < 100 && !(img.complete && img.naturalWidth > 0); t++) await new Promise(r => setTimeout(r, 100));
        return img.complete && img.naturalWidth > 0; }, p.i);
      after.push({ ...p, loadsWhenShown: ok });
    }
    const bad = after.filter(p => !p.loadsWhenShown || p.inViewportX && !p.hidden);
    if (bad.length) failures++;
    console.log(`${bad.length ? "FAIL" : "PASS"} ${name} ${path} pending=${JSON.stringify(after)}`);
  }
  await browser.close();
}
console.log(failures ? "LAZY_CHECK_FAIL" : "LAZY_CHECK_PASS");
