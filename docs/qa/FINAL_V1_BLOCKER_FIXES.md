# Final V1.0: handover blocker fixes

Date: 2026-10-14.
- Branch `fix/v1-blockers`: from `integration/warm-editorial-v2` @ `4b0113a`, HEAD `ed6eb0a`.
- Baseline: `docs/qa/FINAL_V1_PRODUCTION_AUDIT.md`, branch `qa/final-v1` @ `81af84d`, pushed.

Roles:
- Claude implemented the fixes and ran QA.
- Codex reviewed independently (`c21-release-validation/FINAL_V1_BLOCKER_FIXES_REVIEW.md`).

Nothing was deployed, merged, migrated or written to production.

**Final verdict: READY_FOR_DEPLOY_REVIEW**

- **Code patch:** approved by Codex in round 3, with no open code finding.
- **Regression:** fully green. Backend 105/105; Vitest 34/34; Playwright 137 passed and 0 failed on both engine configurations.
- **Two decisions are still the owner's before or at the deploy review:**
  1. The **RLS migration (V1-SEC-03, P1, latent)**. Its plan is "ready for owner approval" according to Codex round 4. It is not applied.
  2. Approval to merge and deploy.
- **Owner actions still open from the audit:** the Messenger URL (V1-CONTENT-01) and confirming the DB password rotation (V1-SEC-02).

## 1. Bugs, root causes and fixes

### V1-SEC-01: `POST /api/v1/contact-clicks` (P1) — FIXED

**Root cause:**
- The endpoint had no limiter.
- It wrote one row per request, and accepted any `product_id`: an unknown UUID raised an FK violation, giving a 500.
- It stored an unsalted SHA-256 of the IP.

**Fix (`app/api/v1/public.py`, `core/rate_limit.py`, `core/config.py`):**
- **Limits:** two in-process fixed-window limits, both checked **before any database access**:
  - per client, 10 per minute, with IPv6 grouped by /64;
  - global, 300 per hour, which caps rows written even with forged or rotating IPs.
- **Rejected requests:** `429` with `Retry-After`, and no row is written.
- **Limiter memory:** capped at 10,000 keys. While the map is full of live windows, new keys are refused; known keys keep counting.
- **Trusted client IP:**
  - It is read from `CLIENT_IP_HEADER`, default `CF-Connecting-IP`. onrender.com is served through Cloudflare (`Server: cloudflare` and `CF-RAY` observed), and Cloudflare sets and overwrites this header.
  - Only a single valid IP is accepted; anything else (lists, garbage, absent) falls back to the socket peer.
  - A forged header, possible only on a path that bypasses Cloudflare, can dodge the per-client limit, but not the global cap or the key cap.
- **Product check:** `product_id` must be a *public* product (same rules as the public API), otherwise `422`. A product deleted between the check and the insert also gives `422`.
- **Privacy:** no IP and no IP hash are stored any more (the column stays; no migration).
- **Messenger CTA:** the button opens Messenger **first**, synchronously, then sends tracking with `keepalive` without waiting.
  - Before, `await fetch` delayed the popup by the API latency, 8–38 s on a Render cold start.
  - Safari's popup blocker also drops `window.open` after an `await`.

**Limits of this design:**
- It works per process. Render runs one worker (`WEB_CONCURRENCY=1`, asserted in `test_render_config.py`).
- A restart or Free-plan spin-down resets the counters. That is acceptable for analytics-only writes, which the global cap still bounds while the service is up.
- Running more than one worker needs a shared store.

### V1-BUG-01: saving during an image removal kept a deleted image (P1) — FIXED

**Root cause:**
- Removing a *freshly uploaded* image called `DELETE /admin/media/{id}` first, and only updated the form after that request returned.
- Save stayed enabled meanwhile, so a quick save sent the image that was being deleted.
- The same pattern existed in three places:
  - the product form;
  - the news form;
  - `AdminMediaUpload`, used for banner, logo and favicon (it deleted on "Gỡ ảnh" and on "Thay ảnh"). The banner page did not even pass `onBusyChange`.
- Images that were already saved were handled correctly: they were deleted only after a successful save.

**Fix:**
- **Forms** (`product-form.tsx`, `bai-viet/page.tsx`, `admin-media-upload.tsx`):
  - Removing or replacing an image only changes the form.
  - The file joins the existing post-save cleanup and is deleted after the record is saved. There are no timers.
  - An unsaved removal loses nothing, and a failed save keeps every file.
  - Product images keep exactly one primary image after concurrent upload and remove (`withPrimary`).
- **API** (`app/api/v1/admin.py`), defence in depth for old clients and concurrent admins:
  - Saves of products, posts, banners, categories and settings lock the referenced `media_assets` rows (`FOR SHARE`) and reject soft-deleted ones with `422 "Image was deleted"`. The form shows this in Vietnamese.
  - Media deletes lock the row (`FOR UPDATE`), commit `deleted_at` **before** removing the Storage object, and restore the row if Storage fails, so the delete can be retried.
  - Whichever of a save and a delete commits first wins; the other sees it (422 or 409). No reference to a missing object can be created.
  - The worst crash case leaves an unreferenced object (an orphan), never a broken reference.

**Remaining (P3, Codex DATA-001):** files uploaded in a form that is then abandoned, and objects left by a crash between commit and Storage removal, are orphans. This is the same as before the fix. A reconciliation job (stale unreferenced `media_assets`) is V1.1 work.

### V1-SEC-04: security headers (P2) — FIXED

- **Web Worker:** `worker.ts` + `src/lib/security-headers.ts` set these on every response, including pages stored by Workers Cache:
  - `Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy` (camera, microphone, geolocation, payment, usb, topics off)
  - `Strict-Transport-Security: max-age=15552000`
- **Missing Cache-Control (V1-CACHE-01):** a response without `Cache-Control` now gets `private, no-store`, so it is never stored.
- **Static assets:** `public/_headers` adds nosniff, Referrer-Policy and HSTS. `poweredByHeader: false` removes `X-Powered-By`.
- **No `script-src`, a deliberate decision:**
  - Next streams inline bootstrap scripts, so an enforcing script policy needs either `'unsafe-inline'`, which gives no protection, or a per-request nonce.
  - A nonce cannot work with edge-cached HTML: every visitor would receive the same, already published nonce.
  - XSS is handled at the source instead: bleach sanitises article HTML, JSON-LD escapes `<`, and all other CMS text renders as text. Codex agreed.
- **API** (`app/main.py`):
  - nosniff, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, HSTS, Permissions-Policy;
  - `default-src 'none'; frame-ancestors 'none'` on JSON responses, but not on `/docs` or `/redoc`, which load CDN assets.
  - Unhandled errors are now turned into the redacted 500 *inside* CORS and the header middleware, so they keep both (Codex SEC-003).
  - Only status-200 GETs are marked publicly cacheable. Before, a 500 was sent as `public, max-age=60`.

### V1-UX-01: Vietnamese 404 (P2) — FIXED

`app/not-found.tsx` (unknown URLs, wrapped in the public layout) and `(public)/not-found.tsx` (unknown product or article) render a shared `NotFoundContent`:
- "Lỗi 404" with the heading **"Không tìm thấy trang"** and a short explanation;
- "Xem sản phẩm" and "Về trang chủ" buttons;
- header and footer, with skip-link target `#noi-dung`;
- **real HTTP 404**, `noindex`, `Cache-Control: private, no-cache, no-store`. Non-200 responses are never edge-cacheable.

### V1-SEC-03: RLS for products in hidden categories — PLAN, awaiting approval

Codex classifies this as **P1**, and Claude agrees under the brief's rule.
- Anon and ordinary authenticated users can read, through PostgREST, the products and images of hidden or deleted categories. Future-dated products and their images are already hidden, because the image policy's subquery is itself subject to the products policy (Codex round 2 corrected my first reading).
- Authenticated users have no more access than anon.
- `admin_users`, `contact_clicks`, `audit_logs` and `media_assets` are not reachable: anon gets 401, and an authenticated request gets 403 (not probed).
- `service_role` is server-side only.
- Storage objects are readable only by their random URL; there is no listing.

Read-only production probe:
- anon REST returns exactly the 1 product and 1 image that FastAPI exposes;
- no category is hidden today, so the exposure is **latent**.

Fix: two `alter policy` statements. Forward and rollback SQL, steps and verification are in `docs/qa/RLS_HIDDEN_CATEGORY_MIGRATION_PLAN.md`. **Not applied; needs separate owner approval.**

## 2. Files changed (`git diff --stat 4b0113a..ed6eb0a`: 30 files, +1183/−103)

- **API:**
  - `app/api/v1/public.py`, `app/api/v1/admin.py`, `app/core/rate_limit.py`, `app/core/config.py`, `app/main.py`;
  - tests `test_contact_clicks.py` (new), `test_media_consistency.py` (new), `test_security_headers.py` (new), `test_render_config.py`.
- **Web:**
  - `src/components/contact-button.tsx`, `src/features/admin/product-form.tsx`, `src/app/admin/(cms)/bai-viet/page.tsx`, `src/components/admin-media-upload.tsx`;
  - `worker.ts`, `src/lib/security-headers.ts`, `public/_headers`, `next.config.ts`;
  - `src/app/not-found.tsx`, `src/app/(public)/not-found.tsx`, `src/components/not-found-content.tsx`;
  - e2e `audit-v1.spec.ts` (A1–A8), `v1-fixes.spec.ts` (new), `responsive.spec.ts` (6b), `product-gallery.spec.ts` (G3 harness fix), `playwright.qa-webkit.config.ts`.
- **Config and docs:** `render.yaml` (3 non-secret env vars), `docs/RENDER_DEPLOYMENT.md`, `docs/qa/RLS_HIDDEN_CATEGORY_MIGRATION_PLAN.md`.

## 3. Tests before and after (negative controls run against the old code)

| Test | Old code (`4b0113a`) | New code |
|---|---|---|
| `test_contact_clicks.py` (16): valid; unknown/draft/hidden/deleted product; 4 malformed bodies; rapid repeat → 429 → recovery after the window; global cap; spoofed headers; IPv6 /64; limit before DB; 40-thread concurrency; bounded memory | 10 of 15 failed (the 5 passing are body validation and the limiter primitive) | all pass |
| `test_media_consistency.py` (7): deleted image rejected for product, post, banner and settings; live and unmanaged images accepted; delete commits before Storage removal; Storage failure leaves the asset usable and retryable | 7/7 failed | 7/7 |
| `test_security_headers.py` (4): handled responses; `/docs`; injected 500 with CORS; 429 with CORS | 3/4 failed | 4/4 |
| e2e A6 (product: remove, then double-click Save on a slow network), A7 (news), A8 (banner replace) | A6 failed 4/4 (`test.fail` in the audit) | events are exactly `saved 201` then `delete <removed file>`; 1 product; kept image primary |
| e2e 6b: Messenger opens in under 1.5 s while tracking takes 5 s and returns 429 | — | pass |
| e2e H1–H3, N1 ×3: headers on pages/admin/404/API routes; asset nosniff; admin not frameable from another origin; login still hydrates; 3 kinds of 404 | — | pass, both engines |

## 4. Independent review (Codex)

- **Round 1** (`d079109`): **CHANGES_REQUESTED**.
  - SEC-001 (P1): the RLS migration was missing, which is by design in this task; plan prepared.
  - SEC-002 (P2): the limiter map was unbounded. Fixed by the key cap. The per-client check stays before the global one, so one client's rejected requests do not use up the shared quota.
  - SEC-003 (P2): 500s had no headers or CORS, and the API had no HSTS or Permissions-Policy. Fixed.
  - OPS-001 (P2): the new env var needed a dashboard change. Fixed with a code default and documentation.
  - QA-001 (P2): `test_live_harness_diff` timeout test.
    - It is unchanged since `4b0113a` and passes 5/5 in the locked venv on this machine.
    - It fails in Codex's sandbox, where `taskkill /T` cannot kill the process tree.
  - DATA-001 (P3): orphan reconciliation, deferred.
  - Verified by Codex: contact validation and ordering, the media lock ordering (no deadlock, works with the session pooler), admin auth, CORS, web headers and cache, and the `script-src` decision.
- **Round 2** (`647e0e4`): **CHANGES_REQUESTED**.
  - Accepted: SEC-003; SEC-002, including the client-first reasoning; OPS-001.
  - QA-001 classified as **environment-specific**: it failed again only in the sandbox, which also does not exit cleanly.
  - New findings:
    - R2-CODE-001: a 500 had two different request ids.
    - R2-CODE-002: a full limiter rescanned 10k entries for every new key.
  - RLS plan corrections:
    - future-dated images are already hidden through the products policy;
    - status codes: anon 401, authenticated 403;
    - the Free plan has no daily backups;
    - apply through the canonical path.
- **Round 3** (`be56dbb`): **APPROVE** for the code patch.
  - R2-CODE-001 and R2-CODE-002 are closed, with tests: one request id is stored in `request.state`, and refusals while the limiter is full are O(1).
  - The hydration test fix was accepted.
  - RLS plan, two more corrections: apply through the Alembic `0005` wrapper without `begin`/`commit`, and a deny matrix for 2 roles × 2 policies.
- **Round 4** (`ed6eb0a`, documents only): the **RLS plan is READY FOR OWNER APPROVAL**, with no remaining correction. Operational note: compare complete paged ID sets once the catalogue grows.

## 5. Regression (HEAD `ed6eb0a`; local workerd + fixture API; `--workers=1`; run r4, 2026-10-14)

| Suite | Result | Time |
|---|---|---|
| Backend pytest (locked venv, `-m "not integration_supabase"`) | **105 passed**, 0 failed, 2 deselected (real Supabase) | 14 s |
| ruff / mypy | PASS / PASS (21 files) | |
| TypeScript / ESLint | PASS / PASS (0 warnings) | |
| Vitest (includes 11 asset-skew script tests) | 34/34 | |
| Next + OpenNext build | PASS | 93 s |
| Playwright default: desktop Chromium + mobile WebKit (iPhone 13) | **82 passed, 0 failed, 40 skipped** (desktop 55/6, mobile 27/34) | 369 s |
| Playwright desktop WebKit (Desktop Safari, whole suite) | **55 passed, 0 failed, 6 skipped** | 305 s |
| audit-v1 ×5, desktop WebKit (A1–A8), before the hydration fix | 40/40 | 232 s |
| A2 ×5, desktop WebKit | 5/5 | 36 s |

These suites cover:
- gallery (G1–G3);
- Product UX (P1–P6, C1–C5);
- CMS image workflows (A5–A8);
- contact clicks (pytest + 6b);
- auth, session and logout (13/17/22, A4, F2);
- cache headers and RSC (cache/edge specs + H1);
- SEO (robots, sitemap, canonical, noindex 404);
- mobile responsive (responsive spec on iPhone 13);
- the skew scripts (Vitest).

**Flaky A1/A4 (audit), root cause found and fixed in the tests:**
- An r3 failure of A2 kept a page snapshot: the **Tiêu đề field was empty** while Phụ đề was filled, so the browser blocked Save on the required field.
- Cause: in desktop WebKit the test sometimes typed into the server-rendered admin form **before React had hydrated it**. Hydration then reset the controlled input to its initial empty state.
- The same mechanism explains every intermittent audit failure:
  - **A1:** title lost, so the form never submitted and the test waited 120 s for `/api/revalidate`.
  - **A4:** product name lost, so validation ran instead of the 401 path, and there was no "Phiên đăng nhập đã hết hạn" toast.
  - **A2, A6, A8:** the r2/r3 misses.
- **Correction:** I first blamed the r2 A6/A8 failures on parallel load. That was wrong; it was this race.
- Fix: the audit specs now use the existing `gotoReady`/`waitForHydration` helper, moved from `staging-cms.spec.ts` to the shared `e2e/hydration.ts`, before filling admin forms. Since then r4 has been green on both engines.
- **The product side is a real but minor UX issue, NEW V1-UX-06, P3:** on a slow phone an admin can type into a form before its JavaScript arrives, and lose that text. Suggested V1.1 fix: disable form inputs until hydrated, or make them uncontrolled until mount.

**Skipped tests are not PASS:**
- **10 `staging-cms` tests are BLOCKED**: they need a staging Supabase and owner approval for writes.
- The other skips are project-gated duplicates (fixture-writing specs run once per config, all of them in desktop WebKit) or phone-only and desktop-only layout checks.

**Not verifiable locally:** Workers Cache HIT/MISS. workerd does not emulate it: no `cf-cache-status`. What was checked:
- `Cache-Control`: public pages `public, max-age=0, s-maxage=300`; admin `private, no-store`; 404 private; missing → `private, no-store`;
- `Vary`, unchanged (Codex).

HIT/MISS goes in the post-deploy checklist (§7).

## 6. Compatibility

| Combination | Result |
|---|---|
| New API + old web (between steps) | Contact clicks work. The old forms still delete on removal, but the new API rejects a save that references a deleted image (422), so no broken image is stored; the old form shows the raw message. Headers are additive |
| New web + old API | New forms defer deletion; the old API accepts it. Contact tracking is unchanged |
| Database | No schema change. `ip_hash` is simply no longer written |

## 7. Production deployment plan (needs owner approval; nothing done yet)

The branch must reach `deploy/c2-preview` (Render deploys that branch), which is the repository's main branch. **The merge needs the owner's approval.**

1. **Owner actions first:**
   - Messenger URL in Admin → Cài đặt (V1-CONTENT-01);
   - confirm the DB password rotation (V1-SEC-02).
2. **Backend (Render, manual):**
   - In Dashboard → Environment, set and check `CLIENT_IP_HEADER=CF-Connecting-IP`, `CONTACT_CLICK_LIMIT_PER_MINUTE=10` and `CONTACT_CLICK_GLOBAL_LIMIT_PER_HOUR=300`. These are also the code defaults.
   - Merge into `deploy/c2-preview`, then Manual Deploy.
   - GET smoke: `/health/ready` 200; `X-Frame-Options`, `nosniff`, HSTS on `/api/v1/products`; a public product page loads.
   - Rollback: Render → previous deploy `fa76152`.
3. **Frontend, P → P′ → N** (`docs/deployment/TASK_P1_ASSET_VERSION_SKEW.md`, "Standard procedure"):
   - **P** = `d65ec5a0` (built from `70dac36`). `.deploy-assets/` is empty on this machine, so first rebuild `70dac36` and archive it as `.deploy-assets/70dac36` (runbook step 0).
   - **N** = the build of the merged commit; archive its `_next/static`.
   - **Step A:** build P′ (`70dac36` + N's assets via `merge-previous-assets.mjs`) and `versions upload`. Preview gate: `verify-assets-live.mjs <preview> .deploy-assets/<N> .deploy-assets/70dac36 --soak 30`. Then `versions deploy P′@100%`, and the hard gate on the apex with `--soak 300`.
   - **Step B:** build N + P's assets and upload. Then `versions deploy N@100%` and the gate on the apex with N + P assets, `--soak 300`.
   - **Rollback:** before step A, stay on P. After step A, roll back to **P**. During or after step B, roll back to **P′**.
4. **Post-deploy checks (read-only):**
   - Workers Cache: MISS then HIT on `/`, `/san-pham` and a product; `/admin*` BYPASS; 404 BYPASS.
   - Headers on a HIT response.
   - The admin login cannot be framed.
   - A product image and the gallery load from Supabase.
   - Login and logout work.
   - "Nhắn tin để mua" opens Messenger.
   - Tail for 15 minutes: 0 exceptions.
5. **RLS migration:** only after separate approval, per its plan.

## 8. Remaining items (not in this patch)

- **V1-SEC-03:** RLS migration, awaiting approval.
- **V1-CONTENT-01 / V1-SEC-02:** owner actions.
- **P2:**
  - V1-SEARCH-01 / V1-PERF-01: accent-insensitive search plus an index; needs a migration.
  - V1-UX-02: stale content on Back after a reload.
  - V1-UX-03: news admin UX.
- **P3:** DATA-001 orphan reconciliation; V1-UX-06 (input typed before hydration is lost); the P3 list in the audit report.
- **Free-hosting risks** are unchanged: Worker CPU on MISS above 10 ms, the daily request quota, Render cold starts.
