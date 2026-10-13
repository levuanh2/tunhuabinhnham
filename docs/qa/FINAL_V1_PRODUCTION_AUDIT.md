# Final V1.0: full system QA and production audit

Date: 2026-10-13/14 (UTC). Branch `qa/final-v1` (from `integration/warm-editorial-v2` @ `4b0113a`).

Roles:
- **QA, integration and UI/UX audit:** Claude.
- **Independent backend/security/performance review:** Codex (`c21-release-validation/FINAL_V1_CODEX_REVIEW.md`). Where Claude re-checked a Codex result, both views are shown.

Status keys: PASS · FAIL · BLOCKED · NOT_IMPLEMENTED · ACCEPTED_RISK · CONTENT_INCOMPLETE.

## 1. Executive summary

**Verdict: NOT_READY.** The code base is in good shape: security controls hold, there are no data leaks, and the cache works as designed. Three P1 items block handover; they affect **contacting the shop**, **security** and **product display**:

1. **V1-CONTENT-01**: the main purchase CTA "Nhắn tin để mua" opens `https://m.me/` (placeholder), not the shop's Messenger. Owner fix in Admin → Cài đặt (2 minutes).
2. **V1-SEC-01**: the public `POST /contact-clicks` accepts unlimited anonymous writes and turns an unknown product id into a 500 error. Code fix needed.
3. **V1-BUG-01**: removing an image and saving quickly stores a product that still references the deleted image, leaving a broken image on the site. Affects the product form and the news form. Code fix needed.

Also open, owner action: **V1-SEC-02**, the database password was still brand-based at the last check. A Render redeploy at 2026-10-13 16:20Z happened outside this audit; if that was the rotation, please confirm.

Everything else is P2/P3 polish, content to enter, or Free-hosting risk. After items 1–3 (plus the password confirmation) the site can be re-assessed as **READY_WITH_ACCEPTED_RISKS**.

## 2. Versions actually verified (not assumed)

| | Value | How verified |
|---|---|---|
| Integration HEAD | `4b0113a` (local = remote) | `git fetch` + `rev-parse` |
| Production Worker | `d65ec5a0-c59c-4ed9-9909-80dd1cd70231` @100%, deployed 2026-10-13T14:13:22Z | `wrangler deployments status` |
| Worker app code | identical to `4b0113a` (`git diff 70dac36..4b0113a -- app` = 0 lines) | git |
| Production backend | `fa76152`, GitHub deployment 7043868451 `success` 16:21:48Z | GitHub deployments API |
| Backend app code | identical to `4b0113a` (`git diff fa76152..4b0113a -- apps/api/app` = 0 lines) | git |
| Note | Deployment 7043868451 is a redeploy of the same SHA at 16:20Z, not made by this session (owner action, e.g. an env change) | |
| QA branch | `qa/final-v1`: test fixes and new tests only, no app change | |

## 3. Feature coverage matrix

| Area | Feature | Result | Evidence |
|---|---|---|---|
| Public | Home, product list, product detail, category filter, search, news list, about, contact | PASS | production probe and screenshots (120 shots, 0 overflow, 0 JS errors); Playwright |
| Public | News detail | PASS (fixture) / CONTENT_INCOMPLETE (production: 0 posts) | e2e A1 |
| Public | Empty states (empty category, no search result, no posts) | PASS | production nav check; screenshots |
| Public | 404 | **FAIL (UX)**: status 404 + noindex are correct, but the page is Next's default English text and unknown routes have no header/footer (V1-UX-01) | screenshots `route-404-*`, `product-404-*` |
| Public | Open product from home, filter, reload, Back/Forward, URL state | PASS, **one P2**: Back after a reload on a filtered list shows the old filter for 0.5–8 s (V1-UX-02) | `qa-nav.mjs`, `qa-back.mjs` |
| Public | Search with diacritics / not found | PASS | `tủ` → 1, `zzzkhongco` → 0 |
| Public | Search **without** diacritics | **FAIL (P2)**: `tu`, `tu nhua`, `4 canh` → 0 (V1-SEARCH-01) | public API |
| Public | Hidden product / hidden category not public (FastAPI) | PASS | e2e P4, C3, C4; pytest |
| Public | Hidden category through the Supabase Data API | **FAIL (P2/P1)**: V1-SEC-03 | RLS policy, migration line 108 |
| Public | Internal links | PASS (10/10 → 200) | probe |
| Public | CTAs | hotline `tel:0963542815` PASS · Facebook real page PASS · **Messenger `https://m.me/` CONTENT_INCOMPLETE (P1)** | probe |
| Gallery | 1 image, several images, none, broken, portrait, landscape, low-res, large, transparent | PASS: object-contain, no distortion, cream background, no overflow (Chromium + WebKit, 1440/375) | G1–G3 (both engines); `qa-image-states.mjs` |
| Gallery | 72×90 regression | PASS: 633×792 at 1440/1920 | G1 (negative control on old code: 72) |
| Gallery | Thumbnails, lightbox, Esc, arrows, focus return, layout shift | PASS (CLS < 0.1; production lab CLS 0) | G2/G3 |
| Gallery | Low-resolution originals | ACCEPTED_RISK / P3: a 200×250 file is upscaled ~6× on retina (V1-IMG-01) | `qa-image-states.mjs` |
| Admin auth | Correct and wrong login, unauthenticated access, refresh, corrupted cookie, logout, Back after logout, replayed cookies | PASS | e2e 13/17/22, F2, keyboard script; production 307/401 |
| Admin auth | Session expiring mid-session | PASS (message in Vietnamese, input kept, then login) | e2e A4 |
| Admin auth | API without token / fake token / expired token, roles | PASS | Codex production probe (401 `no-store`); pytest `test_auth`; code review (`require_rate_limited_admin`, admin/editor roles) |
| Products | Create, draft, publish, edit name/description/price, VND format, automatic code, Vietnamese slug, duplicate slug/SKU, manual slug, published slug lock | PASS | e2e P1–P6; Vitest; pytest |
| Products | Upload, set primary, remove image | PASS when the removal finishes before saving (A5); **FAIL when saving during a removal (V1-BUG-01)** | e2e A5, A6 (`test.fail`), `qa-remove-race.mjs` |
| Products | Show/hide | PASS | e2e P4 |
| Products | Saved but cache refresh failed: no duplicate | PASS | e2e P5 |
| Products | Admin search "tên hoặc SKU" | **FAIL (P3)**: the API searches the name only (V1-ADMIN-01) | `catalog.py:89` |
| Categories | Create, rename, description, reorder, hide/show, delete empty, block delete with products, no assignment to a deleted category, `product_count`, public filter | PASS | e2e C1–C5; pytest |
| CMS | News create/publish/listing | PASS (fixture) | e2e A1 |
| CMS | News UX | **P2**: technical terms (Slug, Nội dung HTML, SEO title, Xuất bản), manual slug, raw HTML editing (V1-UX-03) | screenshot `admin/news-*` |
| CMS | Banners: add with uploaded image | PASS | e2e A2 |
| CMS | Settings: hotline/Messenger reach the public CTAs; store name everywhere | PASS | e2e A3, 15 |
| CMS | Logo / favicon pickers | PASS (present, busy-state guarded); upload covered by the media pipeline (A2/A5) | screenshot `admin/settings-*` |

## 4. Functional QA: production flows (read-only)

`qa-nav.mjs` ran in Chromium and WebKit at 1440 and 390:

| Check | Result |
|---|---|
| Home → product card → product page | PASS (4/4) |
| Category tab updates the URL | PASS (4/4) |
| Reload keeps the filter (heading + `aria-current`) | PASS (4/4) |
| Back from product → filtered list | PASS (4/4) |
| Forward ×2 → product | PASS (4/4) |
| No-result search: empty state + "Xem tất cả sản phẩm" | PASS (4/4) |
| Empty category: own empty state | PASS (4/4) |
| Second Back (after the reload) → "Tất cả sản phẩm" | **FAIL** (V1-UX-02): measured stale for 0.5 s (WebKit) and 2–8 s (Chromium), correct afterwards; without the reload it is correct immediately |

WebKit reports cancelled RSC prefetches as "access control checks" page errors during navigation. The same harness artefact was seen in earlier gates; navigation is not affected.

## 5. UI/UX findings (Warm Editorial V2; screenshots in `docs/qa/screenshots-final-v1/`)

Coverage: 12 public pages × 375/390/768/1440/1920 × Chromium/WebKit (120 shots) and 8 admin pages × the same widths (80 shots).

| ID | Sev | Page | Finding |
|---|---|---|---|
| V1-UX-01 | P2 | unknown routes, unknown product/article | Next's default English "404: This page could not be found." Unknown routes have **no header/footer**, so the visitor is stuck. Fix: `app/not-found.tsx` (and segment versions) in Vietnamese with links to Sản phẩm and Liên hệ |
| V1-UX-02 | P2 | `/san-pham` | Back after a reload shows the previous filter with no loading feedback (§4). Fix: `loading.tsx` for the segment or a pending indicator |
| V1-UX-03 | P2 | Admin → Bài viết | Technical terms, manual slug, raw HTML textarea; inconsistent with the product form. Fix (V1.1): auto slug plus plain labels like the product form, and a simple rich-text or Markdown editor |
| V1-UX-04 | P3 | Home hero | Two CTAs, "Xem sản phẩm" and "Khám phá sản phẩm", both go to `/san-pham` (one as an absolute URL): duplicate action |
| V1-UX-05 | P3 | Product cards | `object-cover` in the 4:5 card crops wide cabinets; the right shelves of the real product are cut in the card (the gallery is fine) |
| V1-ADMIN-01 | P3 | Admin → Sản phẩm | Placeholder "Tìm theo tên hoặc SKU", but only the name is searched; "SKU" is still the column label |
| — | OK | everywhere | Typography, colours, spacing and states are consistent with Warm Editorial V2; no overflow; buttons have hover, focus and disabled states; loading/empty/error messages in Vietnamese |

## 6. Responsive

- No horizontal overflow on any of the 200 public and admin screenshots.
- Mobile menu, filters, gallery thumbnails and admin forms are usable at 375/390.
- Tablet 768 uses single-column galleries at full width (704×880 frame).

## 7. Accessibility (manual + scripted; axe-core / Lighthouse not installed, no new dependency added)

| Check | Result |
|---|---|
| Skip link "Bỏ qua điều hướng" → `#noi-dung`, visible on focus | PASS (Chromium). In WebKit, Tab skips links by default (Safari setting), so this is platform behaviour |
| Visible focus on the first 12 Tab stops | PASS (both engines) |
| Mobile menu `<dialog>`: Enter opens, focus stays in the dialog (only browser UI outside), Escape closes, focus returns to "Mở menu" | PASS (both) |
| Lightbox focus trap and return | PASS (G2) |
| Login error in `p[role=alert]`, Vietnamese; submit with Enter | PASS (both) |
| Form validation: `aria-invalid`, focus moves to the first invalid field | PASS (both) |
| Labels on all fields; named controls; alt text on all images; one h1 per page; `lang="vi"` | PASS (automated over 200 shots) |
| Heading order | P3: `/san-pham` and category pages jump h1 → h3 (cards) |
| Touch targets | P3: some inline text links are under 24 px tall (breadcrumb, "Xoá bộ lọc", contact phone) |
| Admin skip link | P3: none |
| Reduced motion | PASS: `prefers-reduced-motion` CSS and the gallery scroll respect it |

## 8. Backend / API

| Gate | Result (locked environment `E:\Tunhuabinhnham\.venv`, matching `requirements.lock`) |
|---|---|
| pytest `-m "not integration_supabase"` | **78 passed**, 2 deselected, 11.5 s (18 s wall) |
| ruff `--no-cache` | PASS |
| mypy `apps/api/app` | PASS (21 files) |
| pip-audit on `requirements.lock` | **No known vulnerabilities** (6 s) |
| `npm audit --omit=dev` | 0 vulnerabilities |

Codex reported 72/6 failures and mypy/pip-audit BLOCKED (QA-001/002). That was its environment: `bleach` was missing and Starlette 0.41.3 did not match the lock's 1.7.0. In the locked environment all gates pass. Codex's Windows timeout-harness note (`test_live_harness_diff`) did not reproduce here.

Verified by Codex with code references:
- every `/admin/*` route requires an active admin/editor and is rate-limited;
- no IDOR;
- public endpoints exclude unpublished, future, hidden and deleted rows;
- `selectinload`, so no N+1;
- media upload: allowlisted MIME types, signature checks, 8 MiB cap, no SVG;
- responses redact stack traces, inputs and secrets;
- production: malformed input → 422 without trace, fake/expired bearer → 401, hostile CORS origin refused.

## 9. Database safety

- Production was read-only throughout: Supabase was not touched and no writes or migrations were made. The two read-only queries of the earlier gate are the only database reads.
- No orphan rows today: the earlier audit found 0 products and a delete guard on categories.
- **V1-DATA-01 (P2, Codex):** a failed compensation in media upload/delete can leave storage and database out of sync. Related to V1-BUG-01.

## 10. Security

| ID | Sev | Finding | Status |
|---|---|---|---|
| V1-SEC-01 | **P1** | `POST /api/v1/contact-clicks`: public, no rate limit, arbitrary `product_id`; each call writes a row (Free DB size and CPU abuse); an unknown UUID → FK violation → 500 + traceback log. `public.py:130-148` (Codex SEC-002, confirmed by Claude in code; not exercised on production because it is a write) | FAIL: patch needed |
| V1-SEC-02 | **P1** | DB password brand-based at the last check (2026-10-13 12:31 ICT). Storage method is correct (Render env `sync: false`, not in repo or bundle). Value not read in this audit | Owner: rotate to a random value / confirm the 16:20Z redeploy |
| V1-SEC-03 | P2 (Codex: P1) | Supabase RLS `public read published products` / `product images` don't enforce live + visible category (and images miss `published_at`), so products of hidden categories are readable through the Data API with the public anon key. Data is non-confidential (published product info), but it violates the owner's rule that hiding a category applies to the public API too | Needs a migration (approval) |
| V1-SEC-04 | P2 | No security headers on web, admin or API: HSTS, `X-Content-Type-Options`, `X-Frame-Options` / `frame-ancestors` (admin can be framed, so clickjacking), `Referrer-Policy`, CSP; `X-Powered-By: Next.js` exposed | Fix: `headers()` + `poweredByHeader: false` in `next.config`, FastAPI middleware, HSTS at Cloudflare |
| V1-PRIV-01 | P3 | `contact_clicks.ip_hash` = unsalted SHA-256 of the IP (reversible for IPv4), and `request.client.host` behind Render is likely the proxy IP, not the visitor | Salt or drop; use `CF-Connecting-IP` if kept |
| — | PASS | JWT/session (`getUser` verification, revoked-session rejection), no authz bypass/IDOR, CORS allowlist, input validation, upload validation, XSS (article HTML sanitized by bleach; JSON-LD `<` escaped; descriptions rendered as text), error redaction, startup-log redaction (Render `fa76152` contains the fix), no secrets in bundle (scan), dependency audits clean, CSRF N/A for the API (bearer tokens; the cookie-auth `/api/auth/logout` is POST-only, low impact) | |

## 11. Workers Cache (production, measured)

| Check | Result |
|---|---|
| Anonymous HTML MISS → HIT | PASS (sample: 20/24 HIT; first visits after expiry EXPIRED) |
| HIT avoids Worker execution | PASS: 15-minute tail had **5** invocations while ≥ 24 page requests were served (the 4 expired renders + 1 bot probe) |
| Admin always BYPASS | PASS (`/admin*` 307/200 BYPASS, `private, no-store`) |
| API/Auth not cached publicly | PASS (`POST /api/revalidate` anonymous → 401) |
| RSC variants not mixed | PASS: signed RSC HIT; missing router headers BYPASS private HTML; `rsc`-only or altered tree → 307 BYPASS |
| Cookie/session leakage | PASS: session cookie on a cached URL gets the anonymous page; admin with cookie → 307 BYPASS |
| 404 / redirects not cached | PASS (404 BYPASS; 308 trailing slash BYPASS) |
| Cache poisoning (`X-Forwarded-Host`, `X-Original-URL`, `X-Rewrite-URL`, `X-Forwarded-Proto`, odd `Accept-Language` on a fresh key) | PASS: cached copy has no `evil.example`, no admin markup, correct canonical |
| Degraded backend not cached | PASS (e2e 20, fixture outage) |
| Revalidation on CMS change | PASS (fixture e2e: revalidate 200 on product, category and article saves) |
| **V1-CACHE-01** (P3) | `GET /api/revalidate` and `/api/auth/logout` return 405 **without `Cache-Control`**, and Workers Cache stores it (2nd request HIT). No private data today, but "only explicitly public responses are stored" is not guaranteed for responses lacking the header. Fix: `worker.ts` adds `Cache-Control: private, no-store` to non-eligible responses that have none |

Measured (production, 15-minute tail 16:46–16:59Z plus samples):
- Worker invocations: 5, all `ok`; 0 exceptions; 0 × 1102; 0 × 1027; 0 × 5xx; 1 × 404 (bot `/xmlrpc.php`).
- **CPU on MISS: p50 49 ms, p95 56 ms, max 248 ms, 5/5 over 10 ms.** Workers Free is therefore *not* proven safe: misses regularly exceed the documented 10 ms limit, without errors so far.
- Latency: HIT TTFB 140–240 ms (lab); EXPIRED/MISS TTFB 0.9–3.4 s.
- Static assets: with Workers Cache on, assets are billable requests; a fresh page view is ≈ 1 HTML + 25 assets + 10–12 RSC prefetches (browser tally).
- Bot probes: present (`/xmlrpc.php` in this window; `.git`, `.svn`, `*.php` earlier). Each runs the Worker (404, not cached).
- Render: **cold start observed at 8.4 s** for the first API call (17:08Z), then 0.2–0.4 s; up to 37.65 s observed in Gate C2. Real traffic is very low today, so the HIT ratio of real users could not be measured. That is an estimate gap, not a measurement.

## 12. Asset version skew

| Check | Result |
|---|---|
| `merge-previous-assets.mjs`: hash collision abort, no overwrite, build-artifact-only, Free limits, dry run, idempotent, retention of 3 | PASS (Vitest 6/6; real builds: 5 copied / 37 present / rerun 0) |
| `verify-assets-live.mjs`: contiguous soak, reset on failure, MIME for every extension, unknown extension fails | PASS (Vitest 5/5); production apex and preview URL of `d65ec5a0`: 42 files, 0 failures |
| Mixed versions (current code: P = `5e3b349`, N = `4f64f0f`), two real Workers, Chromium + WebKit | without merge: forward 10/10 unstyled, 43 asset errors; backward 10/10 unstyled, 44. With P′ and N merged: **0 unstyled, 0 asset/MIME errors, 0 page errors, 0 failed navigation steps** in both directions; control 0 |
| Client navigation during deploy, Back, hard refresh, tab open before the deploy, rollback N → P′ | PASS (navigate mode; scenario 3 = rollback to P′) |
| P → P′ → N repeatable | PASS (runbook in `docs/deployment/TASK_P1_ASSET_VERSION_SKEW.md`). Not exercised on production (no frontend release pending) |

## 13. Performance (LAB data only: Chromium/CDP; no field data, so these are not Core Web Vitals)

| Profile | Page | Edge | TTFB | FCP | LCP | CLS | TBT | JS | Fonts | Images |
|---|---|---|---|---|---|---|---|---|---|---|
| Mobile (Slow 4G, 4× CPU) | home | HIT | 143–243 ms | 1.74–1.81 s | 2.60–2.71 s | 0 | 91–103 ms | 178 KB | 194 KB | 66 KB |
| Mobile | products | HIT | 151–192 ms | 1.64–1.69 s | 1.64–1.69 s | 0 | 114–135 ms | 180 KB | 158 KB | 12 KB |
| Mobile | product | EXPIRED / HIT | 3376 / 180 ms | 4.74 / 1.68 s | 4.98 / 1.71 s | 0 | 105–120 ms | 183 KB | 158 KB | 20 KB |
| Mobile | contact | EXPIRED / HIT | 857 / 179 ms | 2.14 / 1.63 s | 2.14 / 1.63 s | 0 | 112–114 ms | 178 KB | 158 KB | 2 KB |
| Desktop (unthrottled) | home | EXPIRED / HIT | 2461 / 180 ms | 2.68 / 0.51 s | 2.75 / 0.51 s | 0 | 0 | 178 KB | 194 KB | 53 KB |
| Desktop | products / product / contact | HIT | 140–220 ms | 0.38–0.66 s | 0.38–0.66 s | 0 | 0 | ~180 KB | ~160 KB | 1–11 KB |

- INP: no field data; lab TBT ≤ 135 ms on throttled mobile.
- **V1-PERF-02 (P3):** fonts (158–194 KB) outweigh JS. Subset or drop unused weights.
- **V1-PERF-01 (P2, Codex):** search uses `ILIKE '%term%'`, which cannot use the existing GIN index. Combine its fix with V1-SEARCH-01.
- The main latency risk is a MISS/EXPIRED render on a cold Render backend (TTFB up to 3.4 s, more on a full cold start).

## 14. SEO

| Check | Result |
|---|---|
| Title / description / canonical on every page | PASS (canonical = apex; product canonical = own URL) |
| robots.txt (`Disallow: /admin`, `/api/`), sitemap.xml (application/xml) | PASS |
| Admin `noindex, nofollow`; 404s `noindex` with real 404 status | PASS |
| www → apex 301, http → https 301, trailing slash 308 | PASS |
| Product JSON-LD `Product` | PASS |
| Open Graph | PASS on the product page (with image); **P3: no `og:image` on other pages** |
| Category URLs | **P3:** every `?category=` page has title "Sản phẩm" and canonical `/san-pham`, so categories are not separately indexable (deliberate canonicalisation today) |
| Sitemap coverage | **P3:** lacks `/gioi-thieu`, `/lien-he` and category URLs |
| Organization / LocalBusiness JSON-LD | NOT_IMPLEMENTED (P3, useful once the address is real) |
| Broken images / links | PASS (0) |

## 15. Full regression (commit `4f64f0f` on `qa/final-v1`; local workerd + fixture API unless stated)

| Suite | Result | Time |
|---|---|---|
| TypeScript | PASS | 5 s |
| ESLint | PASS (0 problems) | 10 s |
| Vitest | **34/34** | 6 s |
| Next.js production build + OpenNext build | PASS | 27 s |
| Playwright default config: desktop Chromium + mobile **WebKit** (iPhone 13) | **65 passed, 0 failed, 37 skipped** | 263 s |
| Playwright QA config: **desktop WebKit** (Desktop Safari, whole suite incl. fixture-writing specs) | 43 passed, 6 skipped, **2 intermittent** (A1 timeout, A4) | 357 s |
| Gallery, Product UX, auth, cache, skew tooling | included above; skew simulation §12 | |
| Backend pytest / ruff / mypy / pip-audit / npm audit | 78 / PASS / PASS / clean / 0 | §8 |

Skipped is not pass:
- 10 `staging-cms` tests are **BLOCKED** (they need a staging environment and write approval);
- the rest are project-gated duplicates (fixture-writing specs run once per config) or phone-only checks;
- every desktop-only spec also ran in desktop WebKit.

Test defects found and fixed on `qa/final-v1` (no app change):
- **G3 failed only in desktop WebKit.** The cause was the test serving a 1×1 image for a `w=1920` request at DPR 2 (WebKit `naturalWidth` 0), not a gallery bug. Fixed in commit `4f64f0f`.
- **New audit spec isolation (A1):** the fixture keeps posts across runs; titles are now unique per run.

Intermittent in desktop WebKit only:
- A1 (one 120 s timeout) and A4 (one missed toast), out of about 15 runs each; both pass when run alone (3/3 and 5/5).
- Classified as **test flakiness, needs follow-up (P3, test infra)**. No product misbehaviour was observed in their traces.

New tests (`e2e/audit-v1.spec.ts`):
- A1 news;
- A2 banners;
- A3 settings → CTAs;
- A4 session expiry;
- A5 image upload/primary/remove;
- **A6 V1-BUG-01 race, marked `test.fail`**: it reproduces 3/3 per engine and will flag when the fix lands.

## 16. Known limitations

- Workers Free: MISS CPU over 10 ms; daily request quota includes assets; bot probes run the Worker.
- Render Free: cold starts of 8–38 s.
- Published product URLs are locked until the slug-redirect task (`TASK_PRODUCT_SLUG_REDIRECT.md`) ships.
- Lab-only performance figures; no field data yet (very low traffic).
- No axe/Lighthouse in the toolchain; accessibility was checked by script and keyboard.

## 17. Bugs and fixes, by priority

| ID | Sev | Type | Route / component | Steps → expected / actual | Root cause | Suggested fix (separate patch + regression test) |
|---|---|---|---|---|---|---|
| V1-CONTENT-01 | **P1** | content | all "Nhắn tin" CTAs | Click "Nhắn tin để mua" → expected: the shop's Messenger; actual: `https://m.me/` | `site_settings.messenger_url` is the placeholder | Owner enters the real m.me link in Admin → Cài đặt (A3 proves the wiring) |
| V1-SEC-01 | **P1** | code | `POST /api/v1/contact-clicks` | Repeated anonymous POSTs → expected: limited, valid ids only; actual: one row per call; unknown UUID → 500 | no limiter, no product check, FK error unmapped | IP/`CF-Connecting-IP` rate limit at the API, validate a public product (422/404), retention; pytest |
| V1-BUG-01 | **P1** | code | Admin product form, news form | Upload 2 images, "Gỡ ảnh", save immediately → expected: 1 image saved; actual: 2 saved, one deleted in storage (broken image) | Save stays enabled while `deleteAdminMedia` is pending; the state updates after the network call | Block save/remove while a removal is pending (like `isUploading`), or remove from the form first and delete newly uploaded media after a successful save; A6 turns green |
| V1-SEC-02 | **P1** | owner | DB credentials | — | weak, brand-based value (last check) | Rotate to a generated value (Supabase → Render `DATABASE_URL` → Manual Deploy → local `.env`), or confirm the 16:20Z redeploy was that |
| V1-SEC-03 | P2 (Codex P1) | code + migration | Supabase RLS | anon REST select of a product in a hidden category → returned | policy lacks the category condition | Incremental migration for the products/product_images policies; anon-role tests |
| V1-SEARCH-01 | P2 | code (+ migration for the index) | `/san-pham?search=` | "tu nhua" → expected: Tủ Nhựa…; actual: 0 | plain `ILIKE`, accent-sensitive | Accent-insensitive search (`unaccent` / normalized column + trigram index), merged with V1-PERF-01 |
| V1-SEC-04 | P2 | config | web, admin, API | — | no headers configured | `next.config` `headers()` (HSTS, nosniff, `frame-ancestors 'none'` for `/admin`, Referrer-Policy), `poweredByHeader: false`; API middleware |
| V1-UX-01 | P2 | code | 404 pages | `/khong-co-trang-nay` → expected: branded Vietnamese 404; actual: English Next default, no navigation | no `not-found.tsx` | Add `app/not-found.tsx` (+ `(public)` segment) |
| V1-UX-02 | P2 | code | `/san-pham` Back after reload | §4 | no pending UI while the RSC loads | `loading.tsx` / pending indicator |
| V1-UX-03 | P2 | V1.1 UX | Admin → Bài viết | — | form predates the product UX work | auto slug, plain labels, simple editor |
| V1-DATA-01 | P2 | code | media upload/delete | — | best-effort compensation | outbox/reconciliation |
| V1-PERF-01 | P2 | code | search | — | `ILIKE` without a usable index | with V1-SEARCH-01 |
| V1-CACHE-01 | P3 | code | `worker.ts` | GET `/api/revalidate` twice → 2nd HIT | 405 without `Cache-Control` | default `private, no-store` for non-eligible responses |
| V1-ADMIN-01 | P3 | code | Admin product search | search a SKU → none | API searches the name only | search name OR sku; rename the label |
| V1-UX-04/05, SEO (og:image, sitemap, category titles, LocalBusiness), A11Y (heading skip, admin skip link, 24 px inline links), PERF-02 fonts, IMG-01 upload size warning, PRIV-01 ip hash | P3 | code | — | — | — | V1.1 |

Content to enter (CONTENT_INCOMPLETE, owner):
- Messenger URL (P1, above);
- address (the footer and contact page show "Cập nhật địa chỉ trong CMS");
- articles (0);
- remove the sample categories "Đồ dùng" and "Quà tặng" (0 products, approval pending) and add the agreed types;
- a description for "Tủ quần áo";
- more products: real photos ≥ 1600 px on the long side;
- default SEO title and description.

Hosting risks (Free): see §11 and §16 (CPU on MISS, quota, cold start, bots).

## 18. Production release readiness

**NOT_READY.** Path to **READY_WITH_ACCEPTED_RISKS**:
1. **Owner:** Messenger URL in Admin → Cài đặt (and the address).
2. **Owner:** confirm or perform the DB password rotation.
3. **Patch (needs approval)**, then deploy with the backend-first and two-step frontend procedures:
   - V1-SEC-01: contact-clicks limiter and validation;
   - V1-BUG-01: block save during image removal;
   - V1-SEC-04 (headers) and V1-UX-01 (404) are small and recommended in the same patch.
4. Then accept as risks, or schedule: V1-SEC-03 (migration), V1-SEARCH-01/PERF-01 (migration), and the Free-hosting risks.

Nothing was deployed, merged to main, migrated or written to production during this audit.
