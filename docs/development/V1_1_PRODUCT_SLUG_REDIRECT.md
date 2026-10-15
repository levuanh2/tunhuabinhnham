# V1.1 — Product slug redirect 301

Branch `feat/v1.1-slug-redirect`, from integration `0ff735b`. Commits:
- `6f2b78a` feature;
- `bf3350b` PG suite skips unless the DB is fresh;
- `fd11389` Codex round 1 fixes;
- `9595774` Codex round 2 fixes;
- docs commit (this file).

Not pushed, not deployed. No production migration has been run.

Production rollout: `docs/deployment/V1_1_SLUG_REDIRECT_ROLLOUT.md` (separate approval).

## 1. What changes for people

| | Before (V1.0) | After (V1.1) |
|---|---|---|
| Published product URL | Locked: "Sản phẩm đã đăng nên giữ nguyên đường dẫn…" | "Chỉnh sửa đường dẫn" is always available |
| Saving a new URL for a product customers may have seen | — | A confirmation shows the old URL, the new URL, the full address customers will see, and what happens to the old one. "Quay lại" has the focus, so Enter never moves a URL by accident |
| After saving | — | The form stays open with "Đã đổi đường dẫn" and a "Mở trang sản phẩm" link; nothing typed is lost |
| Customer opens an old URL | — | One `301` straight to the current URL, query string kept |
| Renaming the product (name only) | URL unchanged | URL unchanged ("Đổi tên sản phẩm không làm thay đổi đường dẫn.") |

There is no "slug" or "301" wording in the admin UI.

Screenshots are in `docs/design/screenshots/slug-redirect/`:
- desktop is 1440×900 Chromium, mobile is iPhone 13 WebKit;
- `before/*-1-url-section.png`: the old locked field;
- `after/*-1…6`: the URL section, editing, the confirmation, the saved note, an old URL landing on the new page, and a refused URL taken by another product.

## 2. Architecture

```
Admin form ──PATCH /admin/products/{id} {slug}──► FastAPI CatalogService.update_product
                                                    ├ row lock on the product (FOR UPDATE)
                                                    ├ refuse a slug another product has ever had (409)
                                                    ├ keep the previous slug in product_slugs
                                                    └ record the new slug in product_slugs (same transaction)
Browser GET /san-pham/<old> ──► Worker ──► Next page ──GET /api/v1/products/<old>──► FastAPI
                                                    ├ current slug          → 200 product
                                                    ├ old slug, public prod → 301 Location /api/v1/products/<current>?query
                                                    └ otherwise             → 404
           Next page: product.slug ≠ requested slug → permanentRedirect (308)
           worker.ts: that 308, and only that one → 301 Moved Permanently, Cache-Control: no-store
```

- **One hop, no chains.** Every historical slug points at the product, not at the next slug. So A→B→C sends A and B straight to C, and moving back to A makes B (and C) redirect to A.
- **Ownership forever.** A slug, current or old, belongs to one product for good (unique key `product_slugs.slug`). An old link can never start showing another product.
- **Never freed.** Drafts and scheduled products included. Codex round 2 showed that "was this URL ever public?" cannot be proven from `published_at`:
  - a published row may have no date;
  - a schedule can pass during a rename;
  - the API, the readers and PostgreSQL use different clocks.

  Cost: a typo in a draft's URL stays reserved. The admin then gets the field error "Đường dẫn này đang hoặc đã từng được sản phẩm khác dùng…" and picks another one (auto-generated URLs get a `-2` suffix automatically).
- **No reserved-word list.** `/san-pham/[slug]` has no sibling routes, so no slug can shadow a page. The existing pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$` (max 260) still applies on both the API and the form.

## 3. Schema: migration 0006

Files:
- `supabase/migrations/20261015090000_product_slug_history.sql` (canonical);
- `apps/api/alembic/versions/0006_product_slug_history.py` (executes that SQL; `downgrade()` raises).

```sql
set local lock_timeout = '5s';
create table public.product_slugs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  slug varchar(260) not null unique,          -- constraint product_slugs_slug_key
  created_at timestamptz not null default now()
);
create index ix_product_slugs_product_id on public.product_slugs(product_id);
alter table public.product_slugs enable row level security;   -- no policy: Data API sees nothing
revoke all privileges on table public.product_slugs from anon, authenticated;
insert into public.product_slugs (product_id, slug, created_at)
select id, slug, created_at from public.products;              -- soft-deleted included
-- trigger product_slug_not_owned_elsewhere: before insert or update of slug on products,
-- raise unique_violation (constraint products_slug_key) when another product owns the slug
-- in product_slugs. Function: plpgsql, SECURITY INVOKER, search_path = '', execute revoked
-- from public, anon, authenticated.
```

### Safety analysis

| Question | Answer | Evidence |
|---|---|---|
| Does it change product data? | No. It only reads `products` (backfill) and adds a trigger that only reads. `products` md5 is identical before and after | PG `test_migration_backfills…` |
| Can the Data API read or write the table? | No. RLS is on with no policy, and every privilege of `anon`/`authenticated` is false | PG `test_migration_backfills…`, `test_rls_denies…` |
| Are the 0005 policies intact? | Yes | PG `test_migration_backfills…` |
| Can it hang behind product writes? | No. `lock_timeout 5s`: with `products` locked by another session it gave up after 7 s, everything rolled back (revision 0005, no table, no trigger), and a rerun after the lock released succeeded | `c21-release-validation/v1.1-slug/regression/migration-lock-timeout.txt` |
| Partial apply? | No. One transaction (Alembic). The SQL has no `begin`/`commit` | static test |
| Destructive statements? | None. The static test refuses `drop`/`truncate`/`delete from`/`update … set`/`merge`/`grant`/policy changes/`security definer`/inserts into other tables anywhere outside the function body, and any write, DDL or dynamic SQL inside it. Mutation-checked: ALTER … DROP COLUMN, DELETE in the body, a data-changing CTE, SECURITY DEFINER and INSERT INTO products are all caught | `test_security_migration.py` |
| Size | One row per product (backfill), one more per rename. The catalog is small | — |

### Why there is no downgrade

Dropping `product_slugs` would turn every old link already shared (Zalo, Facebook, Google) into a 404, and could let another product take an old URL. So a DB rollback is a **roll-forward** migration `0007` that fixes forward, while the table stays.

Recovery options, from least to most invasive:
1. Roll the app back. Both backend versions work with the table present (rollout §6–7).
2. Roll forward with `0007`.
3. Last resort: restore the owner's pre-migration `pg_dump --schema=public` (taken before step 2 of the rollout). This loses every product write made after the dump. It is only for a corrupted schema, never for a behaviour bug.

## 4. API contract

`GET /api/v1/products/{slug}` (public):
- current slug of a public product → `200 ProductOut` (unchanged);
- historical slug of a **public** product → `301`, `Location: /api/v1/products/{current}` plus the original query string, `Cache-Control: no-store`, no body;
- anything else → `404 {"error":{"message":"Product not found"}}`. This covers unknown slugs, and old slugs of draft, scheduled, hidden, soft-deleted or hidden-category products (all conditions of `public_product_conditions()`).

`PATCH /api/v1/admin/products/{id}` (admin, `require_admin`):
- `slug` may change at any time. A slug that another product has now or has had → `409 "Slug already exists"`, and nothing is changed (product, images and audit all roll back);
- the audit log entry carries `slug` and `previous_slug`.

`POST /api/v1/admin/products`: same `409` for any slug owned (now or before) by another product.

The location is built from the database (`url_path_for` on a schema-validated slug), never from the request. So there is no open redirect and no header injection.

## 5. Web and Worker

- `src/app/(public)/san-pham/[slug]/page.tsx`: `lib/api.ts` encodes the slug and fetch follows the API's 301. If the product's current slug differs from the requested one, the page calls `permanentRedirect('/san-pham/{current}?query')`, rebuilding repeated query keys.
- `worker.ts` + `isProductMove()` in `src/lib/edge-cache.ts` (owner risk A): Next can only emit 308. The Worker turns a 308 into `301 Moved Permanently` + `Cache-Control: no-store` **only** when all of these hold:
  - the method is GET or HEAD;
  - the request path is `/san-pham/<one segment>`;
  - `Location` is same-origin and another `/san-pham/<one segment>`.

  Every other 308 stays a 308: POST, trailing slash (`/san-pham/x/` → `/san-pham/x`), cross-origin, non-product targets, and other paths. Verified by unit tests (12) and on local workerd: `POST /san-pham/<old>` gave 308, and `GET /san-pham/x/` gave 308.
- Admin form `src/features/admin/product-form.tsx`:
  - the confirmation is a native `<dialog>` opened with `showModal()`, so it is modal, Escape closes it, and focus returns;
  - it shows when the product is published or has a past published date;
  - URL text wraps with `overflow-wrap:anywhere`, so Vietnamese words are not split on phones.

## 6. SEO

| Check | Result |
|---|---|
| Canonical and `og:url` | current URL only (e2e S1) |
| Sitemap | current slugs only; the old slug is absent after a rename (e2e S1) |
| Internal links (`/san-pham` grid, related) | current URLs only (e2e S1) |
| Duplicate content | none: an old URL never renders 200, it redirects |
| Chains or loops | none: one hop, and moving back works (API, PG and e2e tests) |

## 7. Cache

- **Admin is never cached:** `/admin*` is not edge-cacheable, and the response is `private, no-store` (existing tests responsive 18–19 and 22).
- **301 is never cached:** `Cache-Control: no-store` is set on both the API and the Worker, and the Workers Cache only stores eligible 200 responses. A remembered A→B would loop once the product moves back to A, so a 301 must never be cached anywhere.
  - Browsers may still cache a 301 heuristically when no cache header is present. `no-store` prevents that.
- **Invalidation on rename:** a save calls `/api/revalidate`, which runs `revalidateTag('catalog')` and `revalidatePath('/', 'layout')` and purges the `public-html` edge tag. So the new URL, the sitemap and the listings refresh at once (e2e S1 checks the listing and the sitemap right after the save).
- **Workers Free:** no paid feature is used. This is no new mechanism; it is the same Workers Cache as V1.0.
- **Not verifiable locally:** `wrangler dev` does not emit `cf-cache-status`. Only the policy headers are checked locally. Real MISS→HIT and "a 301 is never HIT" are production read-only checks after deploy (rollout §5).

## 8. Security review

| Area | Result |
|---|---|
| Authorization | Writes only through FastAPI admin routes (`require_admin`). The table has no Data API access |
| Disclosure through old URLs | An old slug resolves only for a product that is public now (same predicate as the current-slug lookup). Draft, scheduled, hidden, soft-deleted and hidden-category products return 404 (API test `test_old_urls_never_reveal…`, PG test rename vs hide) |
| Takeover of an old URL | Impossible through the API (409), the DB unique key, or the trigger. The trigger also covers backend `3e8c5f0` after a rollback, which answers its usual 409 |
| Open redirect or header injection | None: the target comes from the DB, and the slug pattern is enforced |
| Cache poisoning | None: a 301 is `no-store`, and only same-origin product moves are converted |
| Trigger function | `SECURITY INVOKER`, `search_path = ''`, fully qualified names, execute revoked from public/anon/authenticated |

Codex independent review (backend, DB, security):
- **Round 1:** APPROVE with P2 ×2 and P3 ×1.
  - Rollback collision: fixed with the trigger.
  - Scheduled-draft inference: fixed by never freeing a slug.
  - Lock wait: fixed with `lock_timeout`.
- **Round 2:** APPROVE with P2 ×2 and P3 ×1.
  - A published row with no date, and a schedule crossing a rename: fixed by never freeing a slug.
  - A weak static guard: fixed with the body allowlist and the anywhere-patterns.
- **Round 3:** pending at the time of writing; see the release report.

Files: `c21-release-validation/v1.1-slug/V1_1_SLUG_REDIRECT_REVIEW*.md`.

## 9. Tests (final code `9595774`)

Fail-before (tests written before the code they check):
- feature tests on the V1.0 code: 11 of 12 failed (the 401 test passes on both);
- round 1 tests on `bf3350b`: 3 of 3 failed;
- round 2 tests on `fd11389`: 5 of 5 failed;
- `isProductMove` cases on the old regex rule: POST, trailing-slash Location and cross-origin would have become 301 (by reading the old rule; that check was not run).

| Suite | Result |
|---|---|
| API pytest (SQLite), `python -m pytest apps/api/tests` | **123 passed**, 0 failed. 13 skipped: 11 PostgreSQL tests run separately below, and 2 live-Supabase tests that need explicit opt-in (never run against production) |
| PostgreSQL 17.11 disposable (`supabase/postgres:17.11.0.004`, 1 GB cap) | **11 / 11 passed**, plus the lock-timeout scenario above |
| ruff / mypy | clean / clean (21 files) |
| tsc / ESLint (`--max-warnings=0`) | clean / clean |
| Vitest | **36 / 36** (includes 11 deploy-script tests and 12 edge-cache tests) |
| Next.js + OpenNext production build | success |
| Playwright, local workerd + fixture API, `--workers=1` | see below |
| Asset version skew (`e2e/skew/simulate-skew.mjs`): N = this branch, P′ = V1.0 code (`0ff735b` = `3e8c5f0` web code) built locally with merged assets | forward (N HTML, P′ assets) and backward (P′ HTML, N assets): **NO_SKEW_FAILURE**. 10/10 pages styled, 0 asset or MIME problems, 0 page errors, 0 failed navigation steps, 167 and 166 cross-version RSC requests all 200 |

Playwright, final run on `9595774`:

| Browser | Passed | Failed | Skipped |
|---|---|---|---|
| Chromium desktop | 58 | 0 | 6 |
| WebKit desktop (Safari) | 58 | 0 | 6 |
| WebKit mobile (iPhone 13) | 28 | 0 | 36 |
| Chromium mobile (Pixel 7) | 28 | 0 | 36 |
| **Total** | **172** | **0** | **84** |

Skips:
- **Not run, not PASS:** `staging-cms.spec.ts` (5 tests × 4 browsers) needs a staging URL, admin credentials and write approval (`BLOCKED_EXTERNAL_CONFIGURATION`).
- **By design:** specs that write shared fixture state run once per engine on the desktop projects (Chromium and WebKit). Phone-only or header-contract tests run on one project. Every non-staging test passed in at least one Chromium and one WebKit project.

Flaky, reported: on the earlier commit `fd11389`, desktop WebKit failed `responsive 21` once. The cause was 0 prefetches seen before `networkidle`, a timing issue in WebKit. The test is unrelated to V1.1. It passed in 3 isolated runs, 2 file runs and 2 full runs afterwards, including the final one.

Coverage by area (spec → tests):

| Area | Where |
|---|---|
| Slug redirect 301 | `slug-redirect` S1–S3; API `test_product_slug_history.py`; PG suite; workerd smoke |
| Product CRUD | `catalog-admin` product-form tests; `audit-v1` A5; API `test_admin_catalog.py` |
| Admin auth/session | `responsive` 13, 17, 18, 22; `audit-v1` A4; `catalog-admin` F2 |
| Product gallery | `product-gallery.spec.ts`; `responsive` 5 |
| CMS image deletion | `audit-v1` A6–A8 |
| Workers Cache policy | `responsive` 19–21; `v1-fixes` H2. Real HIT/MISS is a production check |
| Asset version skew | skew simulation above; deploy-script Vitest |
| SEO, canonical, sitemap | `public` canonical/sitemap/robots; `slug-redirect` S1 |
| Security headers | `v1-fixes` H1; workerd smoke (HSTS, CSP, XFO, nosniff on 301/200/404) |
| 404 page | `v1-fixes` N1 (×3) |
| Contact-click rate limiting | API `test_contact_clicks.py`; `responsive` 6b. See V1-SEC-05 below |

Evidence: `c21-release-validation/v1.1-slug/regression/`. It holds the JSON reports per browser, backend and PG output, the build log, the workerd smoke, the skew results and the lock test.

## 10. Open risks

| ID | Risk | Status |
|---|---|---|
| V1.1-R1 | During a backend rollback to `3e8c5f0`, old URLs of products renamed in V1.1 return 404 (the old API never reads the history). Product writes are safe: the trigger keeps every old slug with its product | accepted, documented in the rollout |
| V1.1-R2 | A typo in a URL stays reserved forever (conservative by design) | accepted |
| V1.1-R3 | Real Workers Cache HIT/MISS and the never-HIT 301 can only be checked on production | rollout §5 |
| V1.1-R4 | The first real 301 in production needs a rename (a write). Default plan: check it at the owner's first real rename | rollout §5 |
| V1-SEC-05 (P3, from V1.0) | **OPEN, not part of V1.1.** The per-client limit (10/min, about 600/h) is above the global 300/h, so one client can use up the hour's quota and later clicks are refused (not counted). The global counter is also consumed by refused or invalid requests (tracking off, 422). Messenger itself is unaffected | proposed as a separate patch, below |

Proposed V1-SEC-05 patch (separate branch, no migration):
- add a per-client hourly cap (for example 30/h) next to the per-minute one;
- consume the global quota only for a click that will be stored, after the tracking flag and product checks;
- add tests for one client at 10/min for an hour (others still counted) and for 422/disabled not consuming the global quota.
