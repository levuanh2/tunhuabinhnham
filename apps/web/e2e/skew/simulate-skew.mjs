// Version-skew simulation between two real local Workers (wrangler dev / workerd) running different builds
// against the fixture API. Reproduces a Cloudflare rollout window, when consecutive requests of one visitor
// reach different Worker versions (production incident 2026-10-13 14:13:51–14:15:03Z).
//
//   node e2e/skew/simulate-skew.mjs <origin A> <origin B> <label>
//
// Mode "mixed": HTML from A, every /_next/static request answered by B.
// Mode "navigate" (tab opened before the deploy): pages load entirely from A, then every later asset AND
// RSC request (client navigation, prefetch) goes to B; the visitor navigates by clicking links; then a
// hard refresh loads the HTML from B.
// Fails (exit 1) on any asset error, MIME mismatch, unstyled page, page error or broken navigation.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium, webkit } = require("@playwright/test");

const [originA, originB, label = "run"] = process.argv.slice(2);
const PAGES = ["/", "/san-pham", "/san-pham/tu-5-tang", "/tin-tuc", "/admin/login"];
const EXPECTED_TYPE = { ".css": /^text\/css/, ".js": /javascript/ };
const result = { label, originA, originB, mixed: [], navigate: [] };
const rscStatus = {}; // status counts of RSC requests answered by the other version (navigate mode)

const styled = page => page.evaluate(() => {
  const css = getComputedStyle(document.body);
  return css.fontFamily.includes("Vietnam") && css.backgroundColor !== "rgba(0, 0, 0, 0)";
});

/** Sends matching requests to `origin` and records failures / MIME mismatches. */
async function routeTo(page, origin, problems, { rsc }) {
  await page.route(url => url.pathname.startsWith("/_next/static/") || (rsc && url.searchParams.has("_rsc")), async route => {
    const request = route.request(), url = new URL(request.url());
    const headers = { ...request.headers() };
    delete headers.host;
    const response = await fetch(origin + url.pathname + url.search, { headers, redirect: "manual" });
    const type = response.headers.get("content-type") ?? "";
    if (url.searchParams.has("_rsc")) rscStatus[response.status] = (rscStatus[response.status] ?? 0) + 1;
    const extension = url.pathname.match(/\.(css|js)$/)?.[0];
    if (!response.ok && response.status !== 307) problems.push(`${response.status} ${url.pathname}${url.search ? "?…" : ""}`);
    else if (extension && !EXPECTED_TYPE[extension].test(type)) problems.push(`MIME ${type} for ${url.pathname}`);
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  });
}

for (const [engineName, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  const browser = await engine.launch();
  for (const path of PAGES) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const problems = [], errors = [];
    page.on("pageerror", e => errors.push(e.message.slice(0, 100)));
    await routeTo(page, originB, problems, { rsc: false });
    await page.goto(originA + path, { waitUntil: "networkidle" });
    result.mixed.push({ engine: engineName, path, styled: await styled(page), problems, pageErrors: errors });
    await page.close();
  }

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const problems = [], errors = [], steps = [];
    let abortedPrefetches = 0;
    // On a build-id mismatch Next answers a client navigation with a full page load; WebKit then reports the
    // RSC prefetches it cancels as "access control checks" errors. Counted separately (documentLoads proves it).
    page.on("pageerror", e => { if (/_rsc=.*access control checks/.test(e.message)) abortedPrefetches++; else errors.push(e.message.slice(0, 100)); });
    await page.goto(`${originA}/`, { waitUntil: "networkidle" }); // tab opened before the deploy
    await routeTo(page, originB, problems, { rsc: true }); // the deploy happens now
    let documentLoads = 0; // full page loads after the switch: Next falls back to a hard navigation on a build mismatch
    page.on("request", request => { if (request.resourceType() === "document") documentLoads++; });
    const navigate = async (name, link, expectedPath, heading) => {
      const isPhone = viewport.width < 768;
      if (isPhone && link.inMenu) { await page.getByRole("button", { name: "Mở menu" }).click().catch(() => {}); }
      // An unstyled page overlaps elements, so the click itself can fail: that is a broken navigation, not a crash.
      const clicked = await link.locator(page).first().click({ timeout: 10000 }).then(() => true, () => false);
      if (clicked) await page.waitForURL(url => url.pathname === expectedPath, { timeout: 15000 }).catch(() => {});
      const ok = clicked && new URL(page.url()).pathname === expectedPath && await page.getByRole("heading", { level: 1, name: heading }).isVisible().catch(() => false);
      steps.push({ step: name, ok, clicked, styled: await styled(page) });
    };
    await navigate("client nav → /san-pham", { locator: p => p.locator('a[href="/san-pham"]:visible'), inMenu: false }, "/san-pham", /Tất cả sản phẩm/);
    await navigate("client nav → product", { locator: p => p.locator('a[href="/san-pham/tu-5-tang"]:visible') }, "/san-pham/tu-5-tang", /Tủ nhựa 5 tầng/);
    await page.goBack().catch(() => {}); await page.waitForLoadState("networkidle").catch(() => {});
    steps.push({ step: "back", ok: new URL(page.url()).pathname === "/san-pham", styled: await styled(page) });
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await routeTo(page, originB, problems, { rsc: true });
    await page.goto(`${originB}/san-pham/tu-5-tang`, { waitUntil: "networkidle" }); // hard refresh: HTML now from B
    steps.push({ step: "hard refresh (HTML from B)", ok: await page.getByRole("heading", { level: 1 }).isVisible(), styled: await styled(page) });
    result.navigate.push({ engine: engineName, width: viewport.width, steps, problems, pageErrors: errors, documentLoads, abortedPrefetches });
    await page.close();
  }
  await browser.close();
}

const bad = [
  ...result.mixed.filter(p => !p.styled || p.problems.length || p.pageErrors.length),
  ...result.navigate.filter(n => n.problems.length || n.pageErrors.length || n.steps.some(s => !s.ok || !s.styled)),
];
result.summary = {
  mixedPages: result.mixed.length, unstyled: result.mixed.filter(p => !p.styled).length,
  assetProblems: [...result.mixed, ...result.navigate].reduce((n, p) => n + p.problems.length, 0),
  pageErrors: [...result.mixed, ...result.navigate].reduce((n, p) => n + p.pageErrors.length, 0),
  navigationRuns: result.navigate.length, failedNavigationSteps: result.navigate.reduce((n, r) => n + r.steps.filter(s => !s.ok || !s.styled).length, 0),
  rscStatusFromOtherVersion: rscStatus,
  hardNavigationFallbacks: result.navigate.reduce((n, r) => n + Math.max(0, r.documentLoads - 1), 0),
  abortedPrefetchesDuringHardNavigation: result.navigate.reduce((n, r) => n + r.abortedPrefetches, 0),
  verdict: bad.length ? "SKEW_BREAKS_PAGES" : "NO_SKEW_FAILURE",
};
console.log(JSON.stringify(result, null, 1));
process.exit(bad.length ? 1 : 0);
