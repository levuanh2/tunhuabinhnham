# Gate C0: read-only preflight checkpoint

Branch `integration/warm-editorial-v2` @ `c5cef6a`. Date: 2026-10-11.

**No mutation was performed.** The live database was queried only inside a `READ ONLY` transaction; the server confirmed `transaction_read_only = on`. The inventory script is `c0/inventory_readonly.py` and its output is `c0/inventory_pre_c1.json`.

## 1. Supabase project identity

| Item | Value |
|---|---|
| Project ref | `fyaourksnjeldsvuedox` (fingerprint `sha256(ref)[:12] = cbda20f5bbaa`, the same project approved in Gate B) |
| Backend DB | Supavisor pooler `aws-0-ap-southeast-2.pooler.supabase.com:5432` (session mode), user `postgres.<ref>` |
| Frontend | `NEXT_PUBLIC_SUPABASE_URL` resolves to the same ref (`supabase_url_ref_matches = true`) |
| Server | PostgreSQL **17.11**, database `postgres`, current role `postgres` |
| Environment label | `APP_ENV=development`, **but this is the single live project** (it holds the real `site_settings` row and 2 real `contact_clicks`). Treat it as production-grade. |
| Schema revision | Alembic **`0003`** (0004 not applied) |

### Baseline inventory (pre-C1)

| Table / store | Rows | `__e2e_` residue |
|---|---|---|
| `admin_users` | **0** | 0 |
| `categories` | 2 | 0 |
| `products`, `product_images`, `posts`, `post_images`, `banners`, `media_assets`, `audit_logs` | 0 each | 0 |
| `site_settings` | 1 (`store_name = "Tủ Hòa Bình Nhâm"`, no logo or favicon) | 0 |
| `contact_clicks` | 2 (real, must be preserved) | 0 |
| `auth.users` | **0** | 0 |
| `storage.objects` | 0 in each of `banners`, `branding`, `post-images`, `product-images` (all public, 8 MiB limit) | 0 |

Current security posture, which **0004 fixes**:
- `anon` and `authenticated` hold **ALL** privileges (incl. INSERT/UPDATE/DELETE/TRUNCATE) on all 12 public tables.
- `alembic_version` has **RLS disabled**. With the Data API exposing `public`, anonymous clients can read and write it today.
- Other tables are protected only by RLS: write policies don't exist, so writes are denied, but privileges are over-broad.
- `set_updated_at()` is executable by PUBLIC, anon and authenticated.
- `storage.objects` has no policies (all media goes through FastAPI with the server key).
- No policy references `admin_users`.

**Blocker for the E2E and the CMS rename: there is no Auth user and no admin.**

## 2. Backup / restore method

| Option | Status |
|---|---|
| **A (recommended).** Logical `pg_dump` 17 (roles + schema + data, the same shape as Gate B's `E:\Tunhuabinhnham-backups\20261010_gate_b_pre_0002`), stored outside Git with SHA-256. Restore-test it into an isolated local PostgreSQL 17 / `supabase/postgres` container. Verify revision, row counts, constraints, indexes, RLS, policies, grants and buckets. | **BLOCKED**: no `pg_dump`/`psql` on PATH; Supabase CLI in the npx cache has no binary; **Docker Desktop daemon is not running** (`dockerDesktopLinuxEngine` pipe missing); the npm registry is unreliable here. |
| B. Supabase managed backups / PITR (Dashboard → Database → Backups) | **UNKNOWN**: the plan tier cannot be read via SQL. The owner must check whether a daily backup or PITR exists and its timestamp. |
| C. Fallback: Python read-only export of every public row (JSON + SHA-256) plus a full ACL/policy/default-privilege snapshot. | Possible now (data is tiny: 3 meaningful rows + 2 clicks), but **cannot be restore-tested** without a local PostgreSQL. Not sufficient alone. |

Storage needs no byte backup: 0 objects, and E2E only adds objects that are deleted again. `auth.users` is empty.

**Needed from the owner:**
1. Start Docker Desktop, and confirm a PostgreSQL 17 image is available offline (or allow pulling one). Alternatively install the PostgreSQL 17 client tools.
2. Report the managed backup/PITR status.

Never restore over the live project without separate incident approval (Gate B rule).

## 3. Migration 0004: forward / rollback

Forward (`apps/api/alembic/versions/0004_security_hardening.py` executes `supabase/migrations/20261011041446_security_hardening.sql` in **one transaction**):
1. `alter table alembic_version enable row level security` takes an **ACCESS EXCLUSIVE** lock on `alembic_version` (a 1-row metadata table).
2. `revoke all` on `alembic_version`, `admin_users`, `audit_logs`, `contact_clicks`, `media_assets` from anon and authenticated.
3. `revoke all` then `grant select` on the 7 catalogue tables to anon and authenticated.
4. `set_updated_at()`: `security invoker` (already invoker), `search_path = ''` (the body only calls `now()` from `pg_catalog`, so it is safe), and `revoke execute` from public, anon and authenticated. Trigger execution is unaffected.
5. `alter default privileges` (for role `postgres` only) revokes table privileges and function EXECUTE for future objects. `supabase_admin` defaults are unchanged (expected).

**Data affected: none.** No rows change and nothing is dropped. Locks are catalog-level; the only heavy lock is on `alembic_version`. Live activity at audit time: 8 connections, 1 active, no long transactions.

Apply with `PGOPTIONS='-c lock_timeout=5s'` so a blocked lock aborts instead of queueing. Alembic sets no timeout.

Impact check:
- FastAPI connects as the table owner `postgres`, so it is unaffected.
- The frontend never calls PostgREST or Storage directly (grep-verified).
- Public read keeps working through `SELECT` + RLS.
- Storage uses its own service roles.

Rollback:
- Alembic `downgrade()` is **intentionally disabled**.
- A manual SQL generated from the captured pre-0004 ACLs is `c0/rollback_0004_INCIDENT_ONLY.sql`. It is **not executed**. It reopens anon write access, so it is for an incident only, with owner approval.
- Preferred remedy is fix-forward.

Post-apply verification (read-only):
- revision = `0004`
- anon/authenticated have only `SELECT` on the 7 catalogue tables, and nothing on the other 5
- `alembic_version` has RLS on
- `set_updated_at` has `proconfig = {search_path=""}` and no EXECUTE for PUBLIC/anon/authenticated
- the `postgres` default ACLs no longer grant to anon/authenticated
- row counts are unchanged
- `apps/api/scripts/audit_supabase_security.py` passes
- public API reads still return 200

## 4. Planned mutations (after approval only)

Run ID: `gc-<UTC yyyymmddHHMMSS>-<6 hex>`, for example `gc-20261012T091500-a1b2c3`.
- Names and titles are prefixed `__e2e_<runid>_`.
- Slugs are prefixed `e2e-<runid>-`.
- The synthetic email is `__e2e_<runid>_admin@example.invalid` (the `.invalid` TLD cannot receive mail).
- The password is generated in memory and never printed or stored.

| # | Target | Mutation | Reverted? |
|---|---|---|---|
| M1 | Database schema/grants | Apply 0004 once (`alembic upgrade head`) | **Kept** |
| M2 | `auth.users` | Create 1 synthetic user (service key, `email_confirm`) | Deleted |
| M3 | `public.admin_users` | 1 row for M2 (`role=admin`) | Deleted (cascade-safe order) |
| M4 | `public.categories` | ≥1 `e2e-<runid>-…` | Deleted |
| M5 | `public.products`, `public.product_images` | Products with ≥3 images; edit unrelated field (category retention); reorder images; set primary; draft → published → hidden | Deleted (images cascade) |
| M6 | `public.posts`, `public.post_images` | 1 post with images and a cover, published | Deleted (cascade) |
| M7 | `public.banners` | 1 banner. Existing banners: 0, so no reorder of real data | Deleted |
| M8 | `public.site_settings` | Logo + favicon upload, then restore the original values | Restored (except M12) |
| M9 | `public.media_assets` + `storage.objects` (4 buckets) | Each upload creates one asset row and one object under `YYYY/MM/<uuid>.<ext>` (no run prefix; tracked by `uploaded_by` + manifest) | Deleted (rows + objects) |
| M10 | `public.audit_logs` | Rows written by admin actions of M3 | Deleted (`admin_user_id`) |
| M11 | `public.contact_clicks` | Possible rows for test products (Messenger CTA) | Deleted for test product ids only; the 2 real rows are untouched |
| M12 | `public.site_settings.store_name` | `Tủ Hòa Bình Nhâm` → **`Tủ Nhựa Bình Nhâm`** through Admin CMS (Cài đặt → Lưu thay đổi) | **Kept** (intentional) |
| — | Next.js cache | `/api/revalidate` by admin saves | n/a |

No other table, bucket, Auth setting, RLS policy, migration, DNS, Render or Cloudflare resource is touched.

## 5. Cleanup plan

1. **Manifest:** `E:\Tunhuabinhnham-backups\<runid>\manifest.jsonl`, outside Git. Each created id is appended immediately: auth user, admin_user, category, product, image, post, banner, media_asset (bucket + key), and the settings snapshot. The run writes in `try/finally`. Cleanup runs even on test failure.
2. **Order:**
   - Restore the settings snapshot, minus `store_name` after M12.
   - Delete objects for manifest/`uploaded_by` assets, then `media_assets`.
   - Delete `contact_clicks` for test products, then products (cascade images), posts (cascade), banners and categories by prefix and manifest id.
   - Delete `audit_logs` by admin id, then `admin_users`, then the Auth user.
3. **Sweep:** remove remaining prefix matches (`__e2e_<runid>_`, `e2e-<runid>-`). Remove any Storage object not present in the baseline listing (baseline is 0 objects).
4. **Proof:** rerun the read-only inventory. Every count must equal the baseline in §1, including 0 Auth users, 0 objects, `contact_clicks = 2` and `categories = 2`. Residue must be 0. Expected diffs are only revision `0004`, the new grants/ACLs and `store_name`.
5. **On failure:** stop and report. Never "fix" by restoring dumps over the live project.

## 6. Harness gaps to close before C1 (proposed owners)

| Gap | File | Owner |
|---|---|---|
| Cleanup restores the whole `site_settings` snapshot, which would undo M12. Exclude `store_name` or do M12 after cleanup | `apps/api/scripts/run_live_cms_e2e.py` | Codex |
| Ports 3000/8000 and repo-root `.venv`/`node_modules` are hardcoded. It must run the **integration** worktree on Claude-isolated ports | same | Codex |
| Desktop project only. Add WebKit (iPhone 13) | same + Playwright invocation | Codex/Claude |
| No manifest, and the baseline diff is prefix-only (uploads are not prefixed) | same + `preflight_live_supabase.py` | Codex |
| Missing scenarios: category retention after editing another field; image reorder + primary persisted after reload; draft→publish; SSR session survives reload; expired/invalid session redirect; logout cookie cleanup | `apps/web/e2e/staging-cms.spec.ts` | Claude |
| The integration worktree has no real web env (the QA `.env.local` was deleted). It needs a real-config `.env.local` with the public anon key only | local, gitignored | Claude |

## 7. Blockers and missing inputs

1. **Backup:** Docker Desktop not running and no `pg_dump` 17. Managed backup/PITR status unknown (owner).
2. **Admin account strategy for M12.** Choose one:
   - **(a)** The synthetic admin performs the rename before cleanup, and the harness keeps `store_name`.
   - **(b)** The owner creates their own permanent admin (their email; they set the password themselves). Claude will not handle real passwords. A production CMS needs a real admin anyway.
3. **Approval** for M1–M12 and for the harness changes in §6.
4. Supabase Auth email confirmation/rate limits: the synthetic user is created through the admin API with `email_confirm`, so no email is sent. No extra credential is needed beyond the existing server key in `apps/api/.env` (it stays local and is never printed).
5. Network: Supabase is reachable (the read-only query succeeded). The npm registry is unreliable but not needed for C1.

**Stop. Awaiting checkpoint C0 approval.**
