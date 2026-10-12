# Gate C1 execution report

Integration branch `integration/warm-editorial-v2` @ **`2f3f9c8`** (originally written at `5d4d62c`; updated after the recovery and after Phases 6–7). Date: 2026-10-12 (Asia/Ho_Chi_Minh).

Recovery details: [`GATE_C1_RECOVERY_REPORT.md`](GATE_C1_RECOVERY_REPORT.md).

Not done in this gate: deploy, DNS change, push, merge to `main`, paid resources, destructive DB operations, incident rollback.

## Status summary

| Phase | Result |
|---|---|
| 1. Herdr coordination | **PASS** (acknowledgements below; harness reassigned to Claude by the owner) |
| 2. Verified backup + restore | **PASS** (Codex; independently re-hashed by Claude) |
| 3. Migration 0004 | **PASS**: revision `0004` (Codex; independently verified read-only by Claude) |
| 3. Supabase Security Advisor | **PASS**: 0 WARN/ERROR, 5 INFO (intended) |
| 4. Harness repair + Playwright specs | **PASS** (harness dry-run against live, read-only; specs dry-run on fixture) |
| 5. Real Supabase E2E (synthetic writes) | **PASS**: run `gc-20261012t041055z-27f859` on `7061a35`. pytest_live PASS; Playwright 9 passed / 1 skipped. Earlier failed runs and their fixes are in the recovery report |
| 5. Cleanup + baseline after real runs | **PASS**: harness and independent read-only check both CLEAN |
| 6. Permanent admin account | **PASS**: one `admin_users` row linked to the owner's Auth user, after read-only checks; real login, authorisation, SSR session and logout exercised by the owner |
| 7. Store brand correction | **PASS**: renamed by the owner through Admin → Cài đặt to "Tủ Nhựa Bình Nhâm"; header, footer, title, `og:site_name` and cache verified on 5 public pages |
| 6–7. Regression with the permanent admin present | **PASS**: real E2E `gc-20261012t053754z-3d0db1` (owner-approved) 9 passed / 1 skipped; the permanent admin, the owner's session and audit row, and the new name all survived cleanup |
| 8. Responsive QA, fixture data | **PASS**: 85/85 screenshots pixel-identical to the approved set, 0 overflow; Playwright 28 passed / 2 skipped |
| 8. Responsive QA, real API, read-only public pages | **PASS**: 63 screens / 9 viewports, 0 overflow; `public.spec` 4/4 (Chromium + WebKit) |
| 9. Regression (local) | **PASS** (see table) |
| 9. npm audit | **FAIL (accepted risk until 2026-11-10)**: 7 total / 2 production |

## Phase 1: Herdr communications (Claude `w1:p0` ↔ Codex `w1:pZ`)

1. Claude sent the C1 assignments (owner terms, ownership split, status-line protocol, pause before Supabase writes). Codex replied **ACK with an 8-step plan**.
2. Claude: "start steps 1–2", plus `--workers=1` and a quota warning. Codex: backup and restore.
3. Claude: Docker safety note (another project's `supabase_*_tec2026-ci` containers). Codex: "ACK … container riêng gate-c1-restore-20261011t165056z … không chạm vào … tec2026-ci".
4. Claude: ACK of backup/restore (independent re-hash) and authorisation of migration 0004 with exact verification items. Codex: `C1_MIGRATION=PASS REVISION=0004`, then a checkpoint `docs/GATE_C1_CODEX_CHECKPOINT.md` (uncommitted, its tree) because its quota fell to about 11%.
5. **Owner decision:** harness reassigned to Claude, through Claude's question prompt. Codex's pane was showing a model-switch dialog at the time, so no message was typed into it to avoid selecting an option. This reassignment is recorded here.

Owner approvals given directly in Codex's pane during the run: Docker/inspect commands, and "tiep tuc di" (continue).

## Phase 2: Backup (outside Git)

`E:\Tunhuabinhnham-backups\20261011T165056Z_gate_c1_pre_0004\`. This is labelled a **partial logical dump**, not a full managed Supabase backup.

| File | SHA-256 |
|---|---|
| `public_storage.dump` | `ebc025d9da50be7249e656f9322d5d1b30bff0c99ba4287f20696a729dd9a394` |
| `roles.sql` | `66228fa5ae04e3db61836b0ab9dd189f130a11a10235dd7f464924f29243119c` |
| `inventory_pre_backup.json` | `60e9c7e9eb320542519d8c8df9ae6c13973439ad30ae24c2d72285517fe007b0` |
| `manifest.json` | `9797f0676a399ef6ae56fecc9c0773369cbe560f0c0a9afac028e4c81d4a9c7e` |

- Source: PostgreSQL 17.11, revision 0003, `storage.objects = 0` reconfirmed.
- Restore into a disposable `postgres:17` container (`gate-c1-restore-20261011t165056z`, removed afterwards) matched:
  - 11/11 row counts, 4/4 buckets, 44 constraints, 26 indexes, 16 triggers
  - 19 RLS tables, 7 policies, 24 grants, 6 default ACLs
  - 15 roles / 21 memberships. `GRANTED BY supabase_admin` attribution cannot be reproduced on stock PostgreSQL; equivalent privileges were verified.
- `set_updated_at` was exercised in a rolled-back transaction.
- Claude re-verified all four hashes (`sha256sum -c`: 4/4 OK) and confirmed no passwords are present.

## Phase 3: Migration 0004

- Inputs re-hashed at `14f9ed4`:
  - SQL `f59bc9435ad455cffdce01dbfac78b543661815e0f54c62eca59fa8afdbee3ee`
  - Alembic wrapper `0b1e6831306af1dde5030be4b12aef4e2c35f8b631572a8eebd0532699e66b71`
- Fingerprint `cbda20f5bbaa`, start revision `0003`.
- Applied **once** via Alembic with `PGOPTIONS=-c lock_timeout=5s -c statement_timeout=60s`. `alembic current` = `0004 (head)`, history linear 0001→0004.
- **Claude's independent read-only diff** (C0 inventory vs post): exactly 5 intended changes, no others.
  - revision `0004`
  - anon/authenticated = `SELECT` only on the 7 catalogue tables, and nothing on `admin_users`, `audit_logs`, `contact_clicks`, `media_assets`, `alembic_version`
  - `alembic_version` RLS on
  - `set_updated_at`: `search_path=""`, EXECUTE only `postgres`/`service_role`
  - `postgres` default ACLs for tables/functions no longer grant anon/authenticated
- Row counts identical; Auth 0; Storage 0.
- Security Advisor (Supabase CLI 2.120.0): **0 WARN/ERROR**; 5 INFO `rls_enabled_no_policy` on the intentionally private tables. `audit_supabase_security.py`: PASS.
- Residual (low): the `postgres` default ACL for **sequences** still grants `rwU` to anon/authenticated. All tables use UUIDs; consider a follow-up migration.
- The incident rollback was not executed.

## Phase 4: Harness and specs

- **Harness** (`apps/api/scripts/run_live_cms_e2e.py`, `gate-c1/harness` `9b9b7cf`, merged):
  - opt-in flag plus `--dry-run`
  - secrets file → API subprocess env only; web/Playwright get only `NEXT_PUBLIC_*`
  - fingerprint, revision and busy-port refusals; ports 3200/8200
  - builds and starts the checked-out tree
  - external manifest JSONL + baseline/after snapshots
  - escaped-prefix and synthetic-admin-scoped cleanup that never touches baseline ids and never reverts `store_name`
  - synthetic Auth user always removed
  - final baseline diff
  - Playwright desktop + mobile `--workers=1`
  - optional live pytest gate
  - Unit test `tests/test_live_harness_diff.py` (3 pass). Ruff and mypy strict clean.
- **Harness dry-run on the live project:** PASS.
  - Run `gc-20261011T174554Z-98fed6`: baseline = C0 counts, servers healthy, empty diff.
  - No secrets in manifest/logs/bundle. The client bundle points to `127.0.0.1:8200`, and no server key appears anywhere in `.next`.
- **Specs** (`apps/web/e2e/staging-cms.spec.ts`, `fff84d7`):
  - Existing: catalogue publish/hide plus Messenger CTA (intercepted `window.open`, no real messaging); post/banner/logo/favicon with settings restore.
  - **New:** draft→publish with category retention after editing another field, image reorder + primary persisted after reload, cache invalidation on detail/listing; SSR session across reload/new page, **expired session** cookie rejected, logout clears `sb-*-auth-token`; mobile (WebKit) drawer + draft product.
  - Dry-run on the fixture API: 5 passed, 1 skipped (phone-only test on desktop).

## Phase 5: Real E2E. **FAIL, cleanup PASS** (see the recovery report)

The permission block was later lifted; the harness ran from Claude's session. Three real runs took place (`fc85cd` interrupted, `e0c14c` and `38fbaf` TEST_FAILED), each cleaned up to the baseline. The last failure: the spec searched `/admin/products?search=<SKU>`, but the API searches `name` only. This is fixed in `c81fd0f`, and the fixture now reproduces the failure with the old spec. The original blocked note follows for the record.

### Original note (superseded)

Claude's attempt to start the run was denied by the session's auto-mode safety classifier. Claude did not work around it. **Owner command** (Bash, from this session with `!`, or any shell):

```bash
cd /e/Tunhuabinhnham-integration && RUN_LIVE_CMS_E2E=true E2E_RUN_PYTEST_LIVE=true E2E_SECRETS_ENV_FILE='E:\Tunhuabinhnham\apps\api\.env' E2E_EXPECTED_REF_FINGERPRINT=cbda20f5bbaa /e/Tunhuabinhnham/.venv/Scripts/python.exe apps/api/scripts/run_live_cms_e2e.py
```

It prints one JSON summary line. The manifest, baseline, after and logs go to `E:\Tunhuabinhnham-backups\<run id>\`. Exit code 2 means the baseline diff found a problem: stop and report it.

## Phases 6–7: permanent admin and brand correction (2026-10-12, Asia/Ho_Chi_Minh)

**Account**
- First attempt: `auth.users` was empty in the project (ref `fyaourksnjeldsvuedox`, fingerprint `cbda20f5bbaa`). No harness run had deleted it: each run deleted only its own synthetic UID.
- The owner then created a user with email `test@gmail.com`. Claude flagged it as a security risk before granting any rights: whoever controls that Gmail inbox could reset the password and take over admin. The owner supplied a second account instead; the `test@gmail.com` user no longer exists (read-only check after the final run).

**Phase 6: link the admin** (`scratchpad/c0/admin_link.py`, outside Git)
- Read-only checks: exactly one Auth user `3d5d2d66-3fb1-42ba-aa37-70b39ad84557` with `admin@tunhuabinhnham.com`; email confirmed; not deleted or banned; UID matches; no duplicate `admin_users` row.
- Write: one transaction that re-checked and inserted **one** row, `d09c4f5f-ff10-4377-a2d2-78684fd37923` (role `admin`, active), verified, then committed. Read-only after: `admin_users` = 1; other tables unchanged.
- No password was requested, displayed, logged or stored.

**Phase 6: real session test**
- The owner logged in on the local integration build (API 8200 + web 3200, live project) in their own browser. Claude never saw the password.

| Check | Result | Evidence |
|---|---|---|
| Login + authorisation | **PASS** | `/api/v1/admin/*` 200 from 05:22:18 UTC (API requires a valid JWT **and** an active `admin_users` row); `last_sign_in_at` set |
| Admin CMS access (dashboard, products, banners, settings) | **PASS** | API log |
| SSR session survives reload | **PASS** | the owner reloaded; admin requests stayed 200 |
| Logout revokes the session | **PASS** | the first login's session no longer exists in `auth.sessions`; the only session is the owner's later re-login (05:23:15) |
| Logged-out `/admin`, `/admin/cai-dat` | **PASS** | `307 → /admin/login` (no cookie) |
| Admin API without a token | **PASS** | `401` |
| Logged-out redirect observed in the owner's own browser right after logout | **not directly observed** | the owner logged in again straight away |

**Phase 7: brand correction through the CMS** (not a DB edit)
- `PATCH /api/v1/admin/site-settings` 200 at 05:22:57 UTC.
- `audit_logs`: `update site_settings` by `admin_user_id d09c4f5f…`.
- DB: `store_name = "Tủ Nhựa Bình Nhâm"`; `logo_url` and `favicon_url` unchanged (null).
- Pre-existing defect fixed first, in `d270169` (merged `2f3f9c8`). Without `default_seo_title`, the public layout returned `title: undefined`, so the homepage had **no `<title>`** and section titles showed no brand; the root title was a hardcoded fallback. Titles and `og:site_name` now come from `store_name` (`absolute` on the homepage, `%s | <store>` below).
  - Regression test `responsive.spec` #14, run on the fixture with a store name that differs from the hardcoded fallback: fails on the old code, passes on the new.

**Brand verification** on 5 public pages (`/`, `/san-pham`, `/tin-tuc`, `/lien-he`, `/gioi-thieu`), two fetches:

| Check | Before | After |
|---|---|---|
| API `store_name` | "Tủ Hòa Bình Nhâm" | "Tủ Nhựa Bình Nhâm" |
| `<title>` | "…Tủ Hòa Bình Nhâm" | "Tủ Nhựa Bình Nhâm" / "Sản phẩm \| Tủ Nhựa Bình Nhâm" … |
| `og:site_name` | old | new |
| Header / footer | old | new |
| Old string anywhere in HTML | 6–8 per page | **0** |
| Cache | ISR `HIT` (old) | regenerated (`MISS` → `HIT`; homepage `HIT`/`STALE` serving new) |

**Regression**
- Web on `2f3f9c8`: **PASS**.
  - lint, tsc, vitest 4/4, Next build, OpenNext;
  - Playwright fixture 30 passed / 12 skipped;
  - visual 85/85 pixel-identical, overflow 0.
- Harness dry-run `gc-20261012t052454z-1223b8`: **PASS**. The baseline contains the permanent `admin_users` id and the owner's Auth UID, so cleanup refuses to touch them.
- Real E2E `gc-20261012t053754z-3d0db1` (owner-approved): **PASS**.
  - pytest_live PASS; Playwright 9 passed / 1 skipped.
  - Cleanup: `cleanup_errors: []`, `baseline_problems: []`; the synthetic Auth user `9b64a5df…` and admin `15f3c93c…` were deleted.
  - Independent read-only check after the run:
    - the owner's Auth user, the `admin_users` row, the `audit_logs` rename row and the owner's session are all intact;
    - `store_name` "Tủ Nhựa Bình Nhâm";
    - categories 2, contact_clicks 2;
    - Storage 0; e2e residue 0.
- Backend: unchanged since `6f64a65` (no API commits); its regression PASS stands.

**Follow-ups (low)**
- The admin login page and the admin shell show a hardcoded store name, not the CMS value.
- The `site_settings` audit row stores `changes = {}`.
- Product detail pages set their own `openGraph`, which drops `og:site_name` there.

## Phase 8 notes (real API, read-only)

- The homepage is statically prerendered at `next build`. When the API is unreachable during the build, the first render uses fallbacks (default brand text, no categories) until ISR (60 s) or an admin save revalidates it. The product listing (dynamic) showed the live `store_name` correctly. **Recommendation for Gate C2:** build with the API reachable, or warm `/` after deploy.
- The live categories are generic seed values ("Đồ dùng", "Quà tặng"). Replace them with real plastic-furniture categories in the CMS.

## Phase 9: Regression on `5d4d62c`

Rerun on **`b2b79a4`** after the recovery: everything below PASS again (Codex `BACKEND_REGRESSION=PASS`; Claude web matrix; visual 85/85; fixture Playwright 28 passed / 12 skipped; `staging-cms` fixture dry-run 9 passed / 1 skipped). Venv-wide pip-audit shows dev/tooling-only advisories (`pytest` 8.4.2, `pip`, `setuptools`); the runtime lockfile is clean. The table shows the original `5d4d62c` run.

| Check | Result |
|---|---|
| Ruff | PASS |
| mypy strict (41 files) | PASS |
| pytest `-m "not integration_supabase"` | PASS: 33 passed, 2 deselected |
| Security regression (auth, migration, validation, CORS) | PASS: 11 |
| pip-audit | PASS: no known vulnerabilities |
| ESLint / TypeScript | PASS (exit 0) |
| Vitest | PASS: 4/4 |
| Next build + OpenNext Worker build | PASS |
| Playwright fixture suite (Chromium + WebKit) | PASS: 28 passed, 2 skipped |
| Visual regression vs approved | PASS: 85/85 identical |
| Playwright `public.spec` on the real API | PASS: 4/4 |
| Real Supabase E2E | **PASS**, cleanup PASS (Phase 5, `27f859`) |
| npm audit (all) | **7**: 6 high, 1 moderate |
| npm audit `--omit=dev` | **2**: `postcss` **high**, `next` **moderate** |

Advisory reconciliation (lockfile `next@15.5.27 → postcss@8.4.31`; app PostCSS `8.5.29` unaffected):
- `postcss` (severity high): GHSA-6g55-p6wh-862q (high, ≤8.5.11), GHSA-r28c-9q8g-f849 (high, ≤8.5.17), GHSA-qx2v-qp2m-jg93 (moderate, <8.5.10), GHSA-fxqj-rqcc-2cmp (moderate, ≤8.5.22).
- `next` (severity **moderate**, range 9.3.4-canary.0 – 16.3.0-preview.10): inherited via postcss. Note: this is the **reverse** of the "Next high / PostCSS moderate" wording in the C1 brief.
- Dev-only: `braces` GHSA-vfj7-8cjw-p6xm (high) via `micromatch → fast-glob → @next/eslint-plugin-next → eslint-config-next`.
- Status: time-limited **ACCEPTED_RISK until 2026-11-10**. **The security audit is not clean.**

## Remaining blockers

1. ~~Phase 5~~: **done**. Real E2E PASS (`gc-20261012t041055z-27f859`), cleanup CLEAN. Gate C1 passes only if it reports `PASS` and the independent read-only cleanup check is clean.
2. ~~Phase 6~~: **done** (permanent admin `d09c4f5f…`).
3. ~~Phase 7~~: **done** (store name "Tủ Nhựa Bình Nhâm" via CMS). Low follow-ups are listed in the Phases 6–7 section.
4. Dependency risk expiry 2026-11-10. The Next 16 trial is still BLOCKED_ENVIRONMENT.
5. Follow-up migration for the sequence default ACL (low).
6. Codex's checkpoint file is uncommitted in `fix/postcss-security`; Codex should commit or move it when its quota is available.
7. Dev dependency hygiene: bump the `pytest<9` pin (PYSEC-2026-1845) and the venv `pip`/`setuptools` (Codex).

## Gate C2 readiness

**Gate C1: PASS** (Phases 1–9). Not clean: the npm audit is ACCEPTED_RISK until 2026-11-10. **Gate C2: not started and not approved.** The dependency decision is outstanding. Deployment checks (Render, Cloudflare, DNS) have not started and are not approved.
