# V1.1 — Product slug redirect 301

Branch `feat/v1.1-slug-redirect`, from integration `0ff735b`. Commits:
- `6f2b78a` feature;
- `bf3350b` PG suite skips unless the DB is fresh;
- `fd11389` Codex round 1 fixes;
- `9595774` Codex round 2 fixes;
- `072b450` first docs;
- `503ec9b` Codex round 3 fixes (the database records every slug);
- `3d57780` V1-SEC-05 contact-click rate limit (separate report: `V1_1_CONTACT_CLICK_RATE_LIMIT.md`);
- `693730e` e2e S4 timing;
- `f2c4df4` Codex round 4 test fixes;
- `a96b2b9` Codex rate-limit review fixes;
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
                                                    └ UPDATE products ─► trigger record_product_slug (same transaction):
                                                        records the old and the new slug, refuses another product's
Any other writer (older backend, direct SQL) ─► the same trigger
Browser GET /san-pham/<old> ──► Worker ──► Next page ──GET /api/v1/products/<old>──► FastAPI
                                                    ├ current slug          → 200 product
                                                    ├ old slug, public prod → 301 Location /api/v1/products/<current>?query
                                                    └ otherwise             → 404
           Next page: product.slug ≠ requested slug → permanentRedirect (308)
           worker.ts: that 308, and only that one → 301 Moved Permanently, Cache-Control: no-store
```

- **One hop, no chains.** Every historical slug points at the product, not at the next slug. So A→B→C sends A and B straight to C, and moving back to A makes B (and C) redirect to A.
- **Ownership forever, enforced by the database.** A slug, current or old, belongs to one product for good (unique key `product_slugs.slug`).
  - The trigger `record_product_slug` records it for **every** writer: the current API, backend `3e8c5f0` after a rollback, and direct SQL.
  - The claim is atomic: `insert … on conflict do nothing` waits for a concurrent claimant, then the owner check refuses another product.
  - So an old link can never start showing another product (Codex round 3).
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
create function public.record_product_slug() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then          -- keep the old slug
    insert into public.product_slugs (product_id, slug) values (old.id, old.slug)
    on conflict (slug) do nothing;
  end if;
  insert into public.product_slugs (product_id, slug) values (new.id, new.slug)
  on conflict (slug) do nothing;    -- waits for a concurrent claim, then sees it
  if exists (select 1 from public.product_slugs s
             where s.slug = new.slug and s.product_id <> new.id) then
    raise exception 'slug belongs to another product'
      using errcode = 'unique_violation', constraint = 'products_slug_key';
  end if;
  return null;                      -- AFTER row trigger: value ignored
end $$;
revoke all on function public.record_product_slug() from public, anon, authenticated;
create trigger record_product_slug after insert or update of slug on public.products
for each row execute function public.record_product_slug();
-- AFTER, so the new row exists for the foreign key. SECURITY INVOKER, empty search_path.
-- products_slug_key: every backend version (3e8c5f0 included) answers "Slug already exists".
```

### Safety analysis

| Question | Answer | Evidence |
|---|---|---|
| Does it change product data? | No. It only reads `products` (backfill) and adds a trigger that writes only `product_slugs`. `products` md5 is identical before and after | PG `test_migration_backfills…` |
| Can the Data API read or write the table? | No. RLS is on with no policy, and every privilege of `anon`/`authenticated` is false | PG `test_migration_backfills…`, `test_rls_denies…` |
| Are the 0005 policies intact? | Yes | PG `test_migration_backfills…` |
| Can it hang behind product writes? | No. `lock_timeout 5s`: with `products` locked by another session, the final migration gave up after 7 s. Everything rolled back (revision 0005, no table, no trigger), and a rerun after the lock released succeeded | `c21-release-validation/v1.1-slug/regression/migration-lock-timeout.txt` |
| Older or direct writers after the migration | Safe. They are recorded by the trigger, and another product's slug is refused with `products_slug_key`. This includes the mixed-version race: a deterministic two-transaction test checks that the taker's own PID is waiting on the lock (it failed on the round-2 SQL) | PG `test_an_older_writer…`, `test_mixed_writers_racing…`, `test_a_writer_that_ignores…` |
| Deadlocks | Reciprocal slug swaps can deadlock on the existing `products.slug` key. PostgreSQL aborts one transaction, and ownership stays intact. The trigger adds no reversed lock order for single-product renames (Codex round 4) | Codex R4 |
| Partial apply? | No. One transaction (Alembic). The SQL has no `begin`/`commit` | static test |
| Destructive statements? | None. The static test compares the migration with the exact reviewed statement list and trigger body, case kept: comments are allowed only as whole lines, and any other statement or clause fails. Mutation-checked: a `'--'` string followed by DELETE in the body, UPDATE ONLY, DISABLE TRIGGER ALL, CALL, a quoted-identifier DROP COLUMN, SECURITY DEFINER, an inline comment, `'UPDATE'`→`'update'`, and the constraint-name case are all caught | `test_slug_history_migration_is_exactly_the_reviewed_one` |
| Size | One row per product (backfill), one more per rename. The catalog is small | — |

### Why there is no downgrade

Dropping `product_slugs` would turn every old link already shared (Zalo, Facebook, Google) into a 404, and could let another product take an old URL. So a DB rollback is a **roll-forward** migration `0007` that fixes forward, while the table stays.

Recovery options, from least to most invasive:
1. Roll the app back. Both backend versions work with the table and trigger present (rollout §6–7).
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
| Takeover of an old URL | Impossible through the API (409), the DB unique key, or the trigger. The trigger records and guards for every writer, backend `3e8c5f0` included, which answers its usual 409 |
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
- **Round 3** (`9595774`): APPROVE with P2 ×2 and P3 ×1.
  - Older or direct writers could still free a slug, and a mixed-version race could hand over a public URL: fixed by moving recording into the trigger.
  - UI and mock states without tests: fixed with e2e S4.
  - Bypasses of the regex guard: fixed with the exact-statement guard.
- **Round 4** (`503ec9b`): **APPROVE, P0 0, P1 0, P2 0, P3 2.**
  - The guard lowercased literals: fixed by keeping case.
  - The race test did not prove the taker waited: fixed by checking the taker's PID.
  - Both fixes are in `f2c4df4`, checked in the rate-limit review. Its one follow-up (race-test cleanup could hang on failure) is fixed in `a96b2b9`.

Files: `c21-release-validation/v1.1-slug/V1_1_SLUG_REDIRECT_REVIEW*.md`.

## 9. Tests (final code `a96b2b9`)

Fail-before (tests written before the code they check, run on the code before the fix):
- feature tests on the V1.0 code: 11 of 12 failed (the 401 test passes on both);
- round 1 tests on `bf3350b`: 3 of 3 failed;
- round 2 tests on `fd11389`: 5 of 5 failed;
- round 3:
  - both new PG tests failed on the `9595774` SQL (the race ended with P2 owning P1's old public URL);
  - e2e S4 failed with the round-2 form predicate, and again with the round-2 mock;
- `isProductMove` cases on the old regex rule: POST, trailing-slash Location and cross-origin would have become 301 (by reading the old rule; that check was not run).

| Suite | Result |
|---|---|
| API pytest (SQLite), `python -m pytest apps/api/tests` (includes the 31 contact-click tests) | **137 passed**, 0 failed. 15 skipped: 13 PostgreSQL tests run separately below, and 2 live-Supabase tests that need explicit opt-in (never run against production) |
| PostgreSQL 17.11 disposable (`supabase/postgres:17.11.0.004`, 1 GB cap) | **13 / 13 passed**. The three race tests passed 3 times on fresh databases, plus the lock-timeout scenario |
| ruff / mypy | clean / clean (21 files) |
| tsc / ESLint (`--max-warnings=0`) | clean / clean |
| Vitest | **36 / 36** (includes 11 deploy-script tests and 12 edge-cache tests) |
| Next.js + OpenNext production build | success |
| Local workerd smoke | old URL 301 with query + `no-store`; HEAD 301; POST stays 308; trailing slash stays 308; new URL 200 cacheable; 404 and admin `no-store`; HSTS, CSP, XFO and nosniff on all of them |
| Playwright, local workerd + fixture API, `--workers=1` | see below |
| Asset version skew (`e2e/skew/simulate-skew.mjs`): N = final build, P′ = V1.0 web code (`0ff735b` = `3e8c5f0`) built locally, with assets merged both ways | forward and backward: **NO_SKEW_FAILURE**. 10/10 pages styled, 0 asset or MIME problems, 0 page errors, 0 failed navigation steps, 169 and 173 cross-version RSC requests all 200 |

Playwright, final runs (web code of `693730e`; later commits change only the API and its tests):

| Browser | Passed | Failed | Skipped |
|---|---|---|---|
| Chromium desktop | 59 | 0 | 6 |
| WebKit desktop (Safari) | 59 | 0 | 6 |
| WebKit mobile (iPhone 13) | 28 | 0 | 37 |
| Chromium mobile (Pixel 7) | 28 | 0 | 37 |
| **Total** | **174** | **0** | **86** |

Skips:
- **Not run, not PASS:** `staging-cms.spec.ts` (5 tests × 4 browsers) needs a staging URL, admin credentials and write approval (`BLOCKED_EXTERNAL_CONFIGURATION`).
- **By design:** specs that write shared fixture state run once per engine on the desktop projects (Chromium and WebKit). Phone-only or header-contract tests run on one project. Every non-staging test passed in at least one Chromium and one WebKit project.

Failures seen during the work, all resolved and reported:
- On `fd11389`, desktop WebKit failed `responsive 21` once (0 prefetches before `networkidle`, a timing issue unrelated to V1.1). It passed in every run since.
- On `3d57780`, desktop WebKit failed the new S4: the form's post-save `router.refresh` raced the test's next `goto`. A probe showed no document reload, and the saved note stays visible, so this was not a UX bug. Fixed in the test (`693730e`, a fresh tab per case): 3/3 on both engines, then the full rerun above.

Coverage by area (spec → tests):

| Area | Where |
|---|---|
| Slug redirect 301 | `slug-redirect` S1–S4; API `test_product_slug_history.py`; PG suite; workerd smoke |
| Product CRUD | `catalog-admin` product-form tests; `audit-v1` A5; API `test_admin_catalog.py` |
| Admin auth/session | `responsive` 13, 17, 18, 22; `audit-v1` A4; `catalog-admin` F2 |
| Product gallery | `product-gallery.spec.ts`; `responsive` 5 |
| CMS image deletion | `audit-v1` A6–A8 |
| Workers Cache policy | `responsive` 19–21; `v1-fixes` H2. Real HIT/MISS is a production check |
| Asset version skew | skew simulation above; deploy-script Vitest |
| SEO, canonical, sitemap | `public` canonical/sitemap/robots; `slug-redirect` S1 |
| Security headers | `v1-fixes` H1; workerd smoke (HSTS, CSP, XFO, nosniff on 301/200/404) |
| 404 page | `v1-fixes` N1 (×3) |
| Contact-click API and rate limiting | API `test_contact_clicks.py` (26); `responsive` 6b (Messenger opens on a slow 429, 500 or timeout). See `V1_1_CONTACT_CLICK_RATE_LIMIT.md` |

Evidence: `c21-release-validation/v1.1-slug/regression/`. It holds the JSON reports per browser, backend and PG output, the build log, the workerd smoke, the skew results and the lock test.

## 10. Open risks

| ID | Risk | Severity | Status |
|---|---|---|---|
| V1.1-R1 | During a backend rollback to `3e8c5f0`, old URLs of products renamed in V1.1 return 404 (the old API never reads the history). Writes stay safe (trigger) | P3 | accepted, rollout §7 |
| V1.1-R2 | A typo in a URL stays reserved forever (conservative by design) | P3 | accepted |
| V1.1-R3 | Real Workers Cache HIT/MISS and the never-HIT 301 can only be checked on production | — | rollout §5 |
| V1.1-R4 | The first real 301 in production needs a rename (a write). Default plan: check it at the owner's first real rename | — | rollout §5 |
| V1-SEC-05 | Contact-click quota starvation | was P3 | **fixed in V1.1** (`3d57780`), with accepted residual risks: `V1_1_CONTACT_CLICK_RATE_LIMIT.md` |
