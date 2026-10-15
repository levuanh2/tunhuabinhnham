# V1.1 product slug redirect and contact-click rate limit: production rollout plan

Status: **plan only.** Nothing in this document has been run against production. Every production step needs the owner's separate approval: the migration, the backend deploy, the frontend deploy, and any test data.

Design and test results:
- `docs/development/V1_1_PRODUCT_SLUG_REDIRECT.md`;
- `docs/development/V1_1_CONTACT_CLICK_RATE_LIMIT.md` (V1-SEC-05: backend only, no migration, ships with the same backend deploy).

## 0. Starting point (verify, do not assume)

| | Expected | How to verify |
|---|---|---|
| Database | Alembic `0005 (head)`, project fingerprint `cbda20f5bbaa` | read-only `alembic current` and the preflight script |
| Backend (Render) | `3e8c5f0` | GitHub deployments of `levuanh2/tunhuabinhnham` |
| Worker | `8ac62f3e-e21a-47f2-b124-7ed027441bef` (N of V1.0), built from `3e8c5f0` | `npx wrangler deployments status` |
| Render auto-deploy | OFF (owner said "có thể đang OFF") | the owner checks Dashboard → Settings → Auto-Deploy; this machine has no Render API key for this workspace |
| Branch | `feat/v1.1-slug-redirect` at the reviewed commit (≥ `a96b2b9`), Codex APPROVE (slug R4, rate limit) | `git log`, `c21-release-validation/v1.1-slug/V1_1_SLUG_REDIRECT_REVIEW*.md` |

Order: **migration → backend → frontend.** Each version stays compatible with its neighbours; see §6.

## 1. Backup and pre-check

- The migration is **additive**: one new table, one index, a backfill, and one trigger on `products` that writes only `product_slugs`. It never changes a product row.
- It sets `lock_timeout = 5s`. If product writes hold a lock, it gives up and rolls back completely (tested: revision stays `0005`, no table, no trigger); simply rerun it. Run it in a quiet moment and ask that nobody saves products in Admin for those few seconds.
- Supabase Free has no automatic backups. Before applying, the owner takes a logical dump of schema `public` (`pg_dump --schema=public --format=custom`) and keeps it off this machine. The agent's tool may not run `pg_dump` against production.
- Read-only pre-check:
  - revision `0005`;
  - row count and md5 of `products`;
  - `to_regclass('public.product_slugs')` is null.

## 2. Migration `0006` (the owner runs it)

```
cd E:/Tunhuabinhnham; E:/Tunhuabinhnham/.venv/Scripts/python.exe -m alembic -c <worktree>/apps/api/alembic.ini upgrade head
```

Expected output: `Running upgrade 0005 -> 0006`.

Read-only checks afterwards:
- revision `0006 (head)`;
- `product_slugs` exists with `relrowsecurity = true`;
- `has_table_privilege` is false for `anon` and `authenticated` (select, insert, update, delete);
- backfill row count equals the `products` row count, and every slug matches its product;
- trigger `record_product_slug` exists on `public.products` (`select tgname from pg_trigger where tgrelid = 'public.products'::regclass and not tgisinternal`);
- `products` md5 is unchanged; the `0005` policies are unchanged;
- anon Data API: `GET /rest/v1/product_slugs` is refused (401/403).

Stop if any check fails. The table can stay in place: neither backend version breaks with it present.

## 3. Backend deploy (Render, manual)

- Fast-forward `deploy/c2-preview` to the reviewed commit.
- The owner clicks **Manual Deploy → that exact SHA**, without Clear build cache.
- Smoke (read-only):
  - `/health/live` and `/health/ready` 200;
  - a current product slug 200, an unknown slug 404;
  - admin endpoints anonymous 401;
- contact clicks (V1-SEC-05):
  - one `POST /api/v1/contact-clicks` with `{}` returns `202 {"accepted": true}`;
  - the same request again at once returns `202 {"accepted": false}` (a repeat, not stored);
  - this writes **one** analytics row, so it needs the owner's OK, or skip it and watch the dashboard after real clicks.
  - CORS and security headers unchanged.
- A 301 exists only after a rename, so it cannot be checked without a write (§5).

## 4. Frontend P → P′ → N (`docs/deployment/TASK_P1_ASSET_VERSION_SKEW.md`)

Values for this release:
- **P_SHA = `3e8c5f0`**;
- **P_VERSION = `8ac62f3e-e21a-47f2-b124-7ed027441bef`**;
- `.deploy-assets/3e8c5f0` is already archived in `E:\Tunhuabinhnham-integration\apps\web`;
- **N** = the reviewed commit.

The procedure is unchanged:
- build N and archive it;
- build P′ from P with N's assets; preview gate; deploy P′; 5-minute apex gate;
- build N with P's assets; preview smoke; deploy N; apex gate with N and P assets.

On this machine, run the apex gate serially. The parallel gate reported only client-side `TypeError` network errors in V1.0.

Rollback targets:
- before step A: P;
- after step A: **P** (`8ac62f3e`);
- during or after step B: **P′**.

## 5. Production checks after N

Read-only:
- Workers Cache: MISS then HIT on `/`, `/san-pham` and a product page; `/admin*` and 404 BYPASS.
- Security headers present, including on a HIT.
- The product page carries a canonical link to itself; the sitemap lists only current slugs.
- Browser smoke on Chromium and WebKit, desktop and mobile: gallery, Messenger, 404, RSC navigation.

The redirect itself needs a rename, which is a write. **Real products must not be used.** Two options for the owner:

1. **Recommended — no production rename now.** The redirect is proven by the PostgreSQL suite, the API suite and e2e on workerd. The first real rename is then made by the owner in Admin; right after it, check:
   - `curl -sI https://tunhuabinhnham.com/san-pham/<old>` gives `301`, `Location: /san-pham/<new>` and `Cache-Control: no-store`;
   - `<new>` gives 200, its canonical points to itself, and the sitemap lists it.
2. **Approved disposable test product.** Create a product named `__e2e_slug_test` (it is public for about 2 minutes), rename it, run the checks above, then delete it in Admin.
   - The two test slugs stay reserved in `product_slugs` forever. Rows are never deleted on purpose.

## 6. Compatibility during the transition

| Database | Backend | Worker | Behaviour |
|---|---|---|---|
| 0006 | old `3e8c5f0` | old `8ac62f3e` | Unchanged. The old API never reads `product_slugs`. The old admin UI cannot change a published URL. |
| 0006 | **new** | old `8ac62f3e` | Current URLs unchanged. An old URL (only after a rename, so avoid renaming in this window) renders the product with **200** and a canonical to the new URL: not broken, but not a 301. |
| 0006 | new | **new** | Target state: old URL 301 → current URL. |

**Rule: no product URL change until N is live.** The old admin UI refuses it anyway.

## 7. Rollback

| What | Target | Effect and caveats |
|---|---|---|
| Frontend | P′ (after step B), P (before step B) | Old URLs then render with 200 and a canonical to the new URL (row 2 of §6). No link breaks. |
| Backend | redeploy `3e8c5f0` | Works with the table and trigger present (it never reads the table). **Old URLs of products renamed in the meantime return 404 until a roll-forward.** Product writes stay safe: the trigger records every slug the old backend writes and refuses any slug another product has had, including in a race. `3e8c5f0` answers its usual 409 "Slug already exists" (PG tests `test_an_older_writer_still_records_every_slug`, `test_mixed_writers_racing_for_a_url_whose_history_is_missing`). The contact-click limits go back to the V1.0 behaviour (V1-SEC-05 open again) |
| Database | **no downgrade** (the wrapper raises) | Dropping `product_slugs` would break every old link already shared. A rollback is a roll-forward migration `0007` that fixes forward; the table stays. |

**Data preservation:**
- History rows are never deleted, drafts included: whether a URL was ever seen cannot be proven.
- Soft-deleted products keep their slugs reserved.

## 8. Stop conditions

Stop on any of these:
- a pre/post migration check differs;
- a 5xx, 1102 or 1027 appears;
- an asset 404 or MIME mismatch;
- a 301 that is cached (any `cf-cache-status: HIT` on a 301) or that chains;
- a hidden product reachable via an old URL;
- a security header missing.

Then roll back with the target for the current phase.

## 9. Production release checklist

Each line needs the owner's go-ahead where marked **(owner)**. Tick in order; stop on any §8 condition.

- [ ] Codex final review APPROVE on the release commit; full regression report attached (`docs/development/V1_1_PRODUCT_SLUG_REDIRECT.md` §9).
- [ ] Owner approves the migration and the rollout separately **(owner)**.
- [ ] §0 verified read-only: DB `0005`, fingerprint `cbda20f5bbaa`, Render `3e8c5f0`, Worker `8ac62f3e`, auto-deploy OFF.
- [ ] Backup: `pg_dump --schema=public --format=custom`, stored off this machine **(owner)**.
- [ ] Pre-check: `products` count and md5; `product_slugs` absent.
- [ ] Quiet moment, nobody saving products; migration `0006` **(owner runs)**.
- [ ] Post-checks §2 (revision, RLS, privileges, backfill, trigger, md5, 0005 policies, anon REST refused).
- [ ] Backend: fast-forward `deploy/c2-preview`, Manual Deploy of that SHA **(owner)**; smoke §3.
- [ ] Frontend: P′ then N per §4 (P_SHA `3e8c5f0`, P_VERSION `8ac62f3e`) **(owner runs wrangler)**; apex gates serial.
- [ ] Production checks §5 (cache MISS/HIT, a 301 never HIT, headers, canonical, sitemap, browsers).
- [ ] First real rename by the owner, then the 301 curl check in §5 option 1.
- [ ] Record versions and rollback targets in the release record.

