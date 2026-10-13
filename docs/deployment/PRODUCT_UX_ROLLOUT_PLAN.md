# Product UX production rollout plan

Status: **prepared, awaiting owner approval**. Nothing in this plan has been executed.

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
