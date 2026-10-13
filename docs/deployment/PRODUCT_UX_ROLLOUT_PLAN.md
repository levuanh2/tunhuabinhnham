# Product UX production rollout plan

Status: **EXECUTED 2026-10-13 (owner-approved). Verdict: PRODUCTION_PASS_WITH_RISK.** See "Rollout result" at the end; the plan below is kept as executed.

| | |
|---|---|
| Source | `integration/warm-editorial-v2` @ `fa76152`. Its code equals `640288e` = Product UX `f57cac1` + hotfix `6f48006`; `fa76152` adds docs only |
| Review | Codex independent review **APPROVE** (`c21-release-validation/INDEPENDENT_REVIEW_PRODUCT_UX.md`) |
| Tests | Backend 78/78, Vitest 23/23, Playwright 56 passed / 0 failed (workerd + fixture), OpenNext build PASS |
| Production now | Render `6f48006` (deployment 7034527688). Worker `tunhuabinhnham-web` version `213692b4` @100% |
| Plans | Workers Free, Render Free (no upgrade) |
| Out of scope | No schema migration, DNS change, or production data write |

## Order: backend API → smoke backend → Cloudflare Worker → smoke frontend/cache

The new web needs the new API (`product_count`, delete guard, hidden-category rule). The old web (`213692b4`) keeps working against the new API, because the API only gets stricter:
- the old category page shows the API message when deleting a used category;
- the old product form never sends `published_at`.

So the backend goes first and can stay alone if the Worker step is postponed.

### 1. Preconditions (read-only)

- `gh api repos/levuanh2/tunhuabinhnham/deployments?per_page=1` shows `6f48006`.
- `npx wrangler deployments status` shows `213692b4` @100%.
- `/health/ready` returns 200.

### 2. Backend API

1. `git push origin fa76152:refs/heads/deploy/c2-preview` (fast-forward from `6f48006`; never force).
2. Render auto-deploy is **off**, so the owner clicks Manual Deploy → Deploy latest commit and checks that the commit shown is `fa76152`.
3. Wait for the GitHub deployment `success` for `fa76152`.

### 3. Backend smoke

- `/health/live` and `/health/ready` return 200.
- CORS preflight from `https://tunhuabinhnham.com` returns 200; an unknown origin is refused.
- `GET /api/v1/admin/products` and `/admin/categories` without a token return 401.
- `GET /api/v1/products`, `/api/v1/categories` and `?category=do-dung` return 200, and the public category JSON has **no** `product_count`.
- `/openapi.json` lists `AdminCategoryOut.product_count` (the new code is live).
- Apex pages still return 200 (old Worker against the new API).

**Rollback (backend):** the owner redeploys commit `6f48006` in Render (Rollback in the Events list), then repeats the smoke. Do not rewrite `deploy/c2-preview` history.

### 4. Cloudflare Worker

1. Build in `E:\Tunhuabinhnham-integration\apps\web` with the production public env (`.env.production.local`): `npx opennextjs-cloudflare build`. Before uploading, scan `.open-next` for secrets, as in Gate C3.1.
2. Run `npx wrangler versions upload --tag product-ux --message "Product UX"`, then smoke the preview URL: public pages, `/admin/login`, no JS errors.
3. Cut over as a single monitored 100% switch, for the same skew reason as Gate C3.1: `npx wrangler versions deploy <new-version>@100%`. Record the deployment id and timestamp.

**Rollback (Worker):** `npx wrangler versions deploy 213692b4-06c3-4e26-86bc-681d49b33e64@100%`. Instant; the per-version cache key prevents stale entries.

### 5. Frontend and cache smoke

- Public `/`, `/san-pham`, `?category=`, `?search=`, detail, `/tin-tuc`, `/lien-he` and `/gioi-thieu`: 200, then MISS → HIT.
- `/admin*`: BYPASS, `private, no-store`.
- Signed RSC replay matrix as in Gate C3.1; a corrupted cookie returns 307.
- Admin on the apex (owner login): the product form shows the new labels; the Loại sản phẩm page shows "0 sản phẩm" for both sample types; there are no "undefined" values; logout and Back still work.
- `wrangler tail`: 0 exceptions, no new 5xx, MISS CPU in line with Gate C3.1.
- Mobile: 5 widths, no horizontal overflow.

### 6. Content follow-up (separate owner approval: production writes)

1. Admin → Loại sản phẩm: delete "Đồ dùng" and "Quà tặng". The read-only audit found **0 linked products of any status**: SAFE_TO_DELETE_AFTER_APPROVAL.
2. Add the six types with the suggestion buttons: Tủ quần áo, Tủ ngăn kéo, Tủ giày dép, Tủ nhựa trẻ em, Tủ đa năng, Kệ nhựa.
3. Every save purges the public cache. Check the `/san-pham` tabs.

### Stop conditions

Roll back immediately on any of these:
- admin data exposed publicly;
- authentication or logout regression;
- new 5xx errors;
- sustained CPU-limit errors;
- a broken public route;
- wrong HTML or RSC variant served;
- an SEO regression (canonical, sitemap).

### Before many real products go live

Implement `docs/design/TASK_PRODUCT_SLUG_REDIRECT.md` (301 redirects for changed product URLs; needs a migration and approval).

## Rollout result (2026-10-13)

| | |
|---|---|
| Backend | Render `fa76152` (GitHub deployment 7038745377, `success` 12:43:08Z; owner Manual Deploy). Previous: `6f48006` |
| Worker | `37eef86b-8124-48b6-84ab-eb24508073b6` @100%, deployment created 12:56:19Z, tag `product-ux`. Rollback: `213692b4-06c3-4e26-86bc-681d49b33e64` |
| Git | `integration/warm-editorial-v2` pushed (`443a937`). `deploy/c2-preview` fast-forwarded `6f48006` → `fa76152`; no force, no merge to main |

### Phase 1: predeploy (PASS)

- `fa76152` contains `6f48006`, `f57cac1`, every reviewed fix, `96884dc` and `7cceb99`. File content checked: `hide_input_in_errors`, `excepthook`, `public_product_conditions` and the three API guards are all present.
- Backend at `fa76152`: pytest 78/78, both startup logging tests pass, ruff and mypy pass.
- The 23 pushed commits contain no env files or secrets.

### Phase 2: backend smoke (PASS)

- `/health/live` 200, `/health/ready` 200.
- CORS apex 200; an unknown origin gets 400.
- Anonymous admin products, categories and dashboard: 401.
- `/openapi.json`: `AdminCategoryOut.product_count` is `integer`, and public `CategoryOut` has no `product_count`.
- Public categories expose only the pre-existing fields.
- `?category=do-dung` 200; an unknown product slug 404.
- The old Worker `213692b4` kept serving the apex with the new API.
- Startup logs: redaction is proven by the startup tests at the deployed commit; the owner checked the Render Logs and found nothing sensitive.
- Published-URL protection and hidden-category hiding are covered by tests at the deployed commit. A live check would need production writes, so none was done for this.

### Phase 3: Worker (PASS)

- Production build from `integration` with public env only; bindings unchanged (`worker.ts`, cache enabled, ASSETS / WORKER_SELF_REFERENCE / IMAGES).
- Bundle scan (1,303 files): no service-role key, secret key, DB URL or password, and no fixture URL or key. The only matches are the publishable anon key and the literal JWT audience `authenticated`, both public by design.
- Preview `productux-…workers.dev`:
  - every public route MISS → HIT, 404 not cached;
  - admin BYPASS `private, no-store`, a corrupted cookie returns 307;
  - signed RSC replay matrix identical to Gate C3.1;
  - Chromium + WebKit, 6 visits, 0 page errors;
  - 80 mobile shots, 0 overflow; errors match the C3.1 baseline only (intended 404 page, aborted `/admin/login` prefetch);
  - the new admin UI chunks are served.

### Phase 4: production smoke on `https://tunhuabinhnham.com` (PASS)

| Check | Result |
|---|---|
| `/`, `/san-pham`, `?category=`, `?search=`, `/tin-tuc`, `/lien-he`, `/gioi-thieu` | 200, MISS → HIT (HIT 0.26–0.49 s) |
| Unknown product | 404 BYPASS |
| `/admin*` | BYPASS, `private, no-store`; anonymous 307 to login; corrupted cookie 307 |
| SEO | canonical apex, sitemap and robots OK; `www` → 301 apex |
| RSC replay | identical to Gate C3.1 (signed HIT; missing or altered router headers BYPASS/307; session-cookie HIT anonymous; admin with cookie 307) |
| Browsers | Chromium + WebKit, 6 visits, 0 page errors |
| Mobile | 80 shots, 0 overflow, no non-baseline errors |
| Owner admin check | login, reload (session kept), product form (URL preview, first-publish note), Loại sản phẩm page, logout + Back, and Render Logs: **no errors** |
| Tail (cutover → end) | 250 invocations, all on `37eef86b`, all `ok`, 0 exceptions, 0 5xx, no 1102/1027; CPU p50 17 ms, p95 251 ms (same profile as C3.1) |

During the admin check the owner also made **real production writes** from their own session (Claude made none):
- created category `tu-quan-ao` at 13:06:28Z;
- uploaded one image;
- created and published product `tu-nhua-4-canh` at 13:07:46Z.

Both saves triggered `/api/revalidate` 200. The product received the generated code `TN-TU-NHUA-4-CANH` and appears on the detail page (canonical self), in the category filter, in "Tất cả sản phẩm", on the homepage and in the sitemap. This confirms automatic URL and code generation and the cache purge on production.

### Remaining

1. **Content (needs approval):** delete "Đồ dùng" and "Quà tặng" (still 0 products; re-check read-only before deleting), and add the other five types. "Tủ quần áo" now exists.
2. **Slug redirect 301** (`docs/design/TASK_PRODUCT_SLUG_REDIRECT.md`) before many products go live: published URLs are locked until then.
3. **Risks carried over:**
   - cache MISS CPU is above the Free 10 ms limit (no 1102 seen);
   - assets count toward 100k requests/day with Workers Cache;
   - scanner 404s run the Worker;
   - **DB password still brand-based (P0)**;
   - Render auto-deploy is off (Manual Deploy after every push).
