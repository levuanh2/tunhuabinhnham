# Gate C1 recovery report

Date: 2026-10-12 (Asia/Ho_Chi_Minh). Coordination: Claude `w1:p0` ↔ Codex `w1:pZ` via Herdr.
Final integration code: `integration/warm-editorial-v2` @ **`b2b79a4`** (the docs commit after it does not change code).

Not done: deploy, DNS, push, merge to `main`, paid resources, a second run of migration 0004, data reset, incident rollback, deletion of baseline rows.

## Verdict

**Gate C1: NOT PASS.** The single real E2E authorised for this recovery ran and cleaned up correctly, but one Playwright test failed. The root cause is a test-lookup defect, not a product defect, and it is now fixed and proven on the fixture. Gate C1 needs **one more real run**, which needs the owner's approval.

| Area | Result |
|---|---|
| Forensics, interrupted run `fc85cd` | Done: DB clean, no orphans |
| Harness hardening (Codex) | PASS: `9ae8e6e` and `5185012` |
| Harness unit tests | PASS: 12/12 |
| Live dry-run | PASS: `gc-20261012t024155z-d2f9d6` |
| Real E2E `gc-20261012t024424z-38fbaf` | **TEST_FAILED**: pytest_live PASS; Playwright 4 passed, 2 failed, 4 did not run |
| Cleanup and baseline (harness plus independent check) | **PASS / CLEAN** |
| Spec fix for the failure | Done: `c81fd0f`. Fixture reproduces the failure with the old spec; the new spec gives 9 passed / 1 skipped |
| Backend regression (Codex `BACKEND_REGRESSION=PASS SHA=b2b79a4`, plus Claude independent) | PASS (see Phase G) |
| Web regression (Claude) | PASS (see Phase G) |
| npm audit | Not clean, unchanged: ACCEPTED_RISK until 2026-11-10 |

## Phase A: forensics of `gc-20261011T181418Z-fc85cd`

- Manifest: baseline, synthetic Auth and admin created, servers ready, pytest_live recorded, synthetic Auth user deleted, `baseline_diff` problems `[]`. Playwright log: `1 interrupted / 9 did not run` in test 1 (desktop).
- Cause: `KeyboardInterrupt`. Most likely a manual Ctrl+C, because the old harness printed nothing for minutes. This is a hypothesis; no stack trace other than the interrupt exists.
- After the interrupt, the `finally` cleanup still ran. A read-only inventory confirmed:
  - Supabase was clean (C0 counts, Auth 0, Storage 0, no run-id residue);
  - no orphan processes; ports free.

## Phase B: read-only Supabase inventory

Pooler session mode ignores `options=-c default_transaction_read_only`, so the checker sets `connection.read_only = True` (only `SELECT` statements had been issued before this was fixed). It reports `ro: on` on every run below.

## Phase C/D: harness repair (Codex) and verification

- `9ae8e6e`:
  - statuses PASS 0 / TEST_FAILED 1 / CLEANUP_INCOMPLETE 2 / INFRA_FAILED 3 / INTERRUPTED 130;
  - per-phase timeouts (build 600 s, server 180 s, pytest 600 s, Playwright 2400 s) with process-tree kill;
  - timestamped progress lines and redacted commands;
  - `FRONTEND_ORIGINS` merged instead of replaced;
  - no-op settings restore; `store_name` never touched.
- `5185012`: lowercase run id (`gc-YYYYMMDDtHHMMSSz-xxxxxx`) so generated slugs match `[a-z0-9]+(?:-[a-z0-9]+)*`.
- Claude reviewed both diffs. `e2e-<runid>-…` slugs still match the cleanup prefix `e2e-<runid>%`.
- Secret scan of the recovery tree: 0 findings.

## Real runs during Gate C1 (all cleaned up)

| Run | Mode | Result | Failure and root cause | Fix |
|---|---|---|---|---|
| `gc-20261011T181418Z-fc85cd` | real | INTERRUPTED | Ctrl+C during a silent harness (hypothesis) | progress output, timeouts (`9ae8e6e`) |
| `gc-20261011T185521Z-e0c14c` | real | TEST_FAILED | pytest PASS; Playwright test 1 failed because the uppercase `T`/`Z` in the run id broke the HTML5 slug pattern, so no POST was sent. Reproduced on the fixture | lowercase run id (`5185012`) |
| `gc-20261012t024424z-38fbaf` | real (**the one authorised in this recovery**) | TEST_FAILED | see below | `c81fd0f` |

Earlier root causes were fixed before these runs: CORS origin replacement in the harness (Codex), and form filling before hydration (`1dd0fc7`, Claude).

## Phase E: the controlled real run `gc-20261012t024424z-38fbaf`

- Integration `844c95e`. Codex was notified on Herdr beforehand. Ports 3200/8200.
- Timeline (UTC):

  | Time | Step |
  |---|---|
  | 02:44:24 | baseline |
  | 02:44:56 | build OK |
  | 02:45:06 | servers ready |
  | 02:45:11 | synthetic fixtures |
  | 02:46:50 | pytest_live **PASS** (Auth/RLS/Storage) |
  | 02:53:25 | Playwright exit 1 |
  | 02:53:46 | final |

- Playwright results (desktop + mobile, `--workers=1`):
  - **PASS**: catalogue publish/hide + Messenger CTA; article/banner/logo/favicon with settings restore.
  - **FAIL**: "draft → publish keeps category, persists image order and primary, invalidates cache" on both projects, with `TypeError: Cannot read properties of undefined (reading 'id')` at `staging-cms.spec.ts:242`.
  - **Did not run** (serial suite stops after a failure): SSR session/expired cookie/logout, and the mobile drawer workflow.
- **Root cause:** the UI save worked (redirect to `/admin/san-pham`; the product row exists in the manifest). The spec then looked the product up with `GET /admin/products?search=<SKU>`, but the API filters `search` on `name` only (`apps/api/app/repositories/catalog.py:76`). The fixture mock matched name **or** SKU, which hid the divergence.
- **Fix `c81fd0f`** (`gate-c1/web`, merged as `b2b79a4`):
  - the spec looks products up by their unique run-scoped name (3 call sites);
  - the mock now matches name only, like the API.
- Proof on the fixture:
  - old spec: same `TypeError` (1 failed);
  - fixed spec: **9 passed, 1 skipped** (phone-only test on desktop).
- **Not yet verified on real Supabase:** the draft→publish/image-order/cache test, and the session/logout and mobile drawer tests, because they did not run.

## Phase F: cleanup verification

- Harness:
  - `cleanup_ok: true`, `cleanup_errors: []`, `baseline_problems: []`, `store_name_changed: false`;
  - manifest: 84 discovered rows, 16 storage objects deleted, synthetic Auth user `45fa142b-…` deleted;
  - discovered rows by table: audit_logs 54, media_assets 16, categories 4, products 4, contact_clicks 2 (baseline, kept), banners 2, posts 2.
- Independent read-only check (`ro: on`), after the run:
  - fingerprint `cbda20f5bbaa`, revision `0004`;
  - counts: admin_users 0, audit_logs 0, banners 0, **categories 2**, **contact_clicks 2**, media_assets 0, posts 0, post_images 0, product_images 0, products 0, site_settings 1;
  - `auth.users` 0, no run-id identities/sessions, `admin_users` run row 0, `storage.objects` 0;
  - all prefix hits 0.
- `site_settings`: identical to baseline in every field except `updated_at` (18:16:02 → 02:52:16 UTC). That change is expected: the branding test performs a real save and restore. `store_name` is still "Tủ Hòa Bình Nhâm".
- Processes: no orphans; ports 3100/8100/3200/8200 free. Only Claude's own fixture processes were stopped, by PID after a command-line check:
  - before the real run: 16224, 17640, 26924;
  - after the fixture runs: 16548, 17184;
  - after the regression: 5136, 6408.

## Phase G: integrated regression on `b2b79a4`

**Backend, Codex (Herdr reply):** `BACKEND_REGRESSION=PASS SHA=b2b79a4 RUFF=PASS MYPY=20_FILES PYTEST=42_PASSED,2_DESELECTED SECURITY=11_PASSED PIP_AUDIT=0_VULNS HARNESS=12_PASSED`. The owner approved Codex's `ruff` command in Codex's pane.

**Backend, Claude (independent):**

| Check | Result |
|---|---|
| Ruff | PASS |
| mypy `apps/api/app` | PASS (20 files) |
| mypy `apps/api` | PASS (46 files) |
| pytest `-m "not integration_supabase"` | PASS: 42 passed, 2 deselected |
| Security subset (auth, CORS, validation, migration) | PASS: 17 |
| pip-audit `-r apps/api/requirements.lock` (runtime, 52 pins) | PASS: no known vulnerabilities |

pip-audit of the whole venv finds 22 advisories in 3 packages, none of them runtime:
- `pip` 24.0 and `setuptools` 65.5.0 are venv tooling;
- `pytest` 8.4.2 is a dev dependency with PYSEC-2026-1845, fixed in 9.0.3, but `pyproject.toml` pins `pytest<9`.

Follow-up for Codex: bump the dev pin and the venv tooling.

**Web (Claude):**

| Check | Result |
|---|---|
| ESLint (`--max-warnings=0`) / `tsc --noEmit` | PASS |
| Vitest | PASS: 4/4 |
| Next build + OpenNext Worker build (mock env, not deployable) | PASS |
| Playwright fixture suite, Chromium + WebKit | PASS: 28 passed, 12 skipped (2 by design; 10 staging tests skip without write env) |
| `staging-cms.spec` full fixture dry-run | PASS: 9 passed, 1 skipped |
| Visual regression vs C1 set (itself identical to the approved set) | PASS: **85/85 pixel-identical**; `overflow` 0. The 22 `offenders` rows are the intentional snap carousels, identical to the baseline |
| npm audit | 7 total (6 high, 1 moderate); `--omit=dev` 2: `postcss` high, `next` moderate. Unchanged; ACCEPTED_RISK until 2026-11-10 |

## Commits

| SHA | Branch | Content |
|---|---|---|
| `1dd0fc7` | `gate-c1/web` | hydration-safe navigation in the live spec |
| `9ae8e6e` | `gate-c1/harness-recovery` | Codex harness hardening |
| `5185012` | `gate-c1/harness-recovery` | Codex lowercase run id |
| `c81fd0f` | `gate-c1/web` | product lookup by name; mock mirrors API |
| `8c83a0f`, `844c95e`, `b2b79a4` | `integration/warm-editorial-v2` | merges |

## Next step (owner decision)

Approve **one more** real run on `b2b79a4` (same command, same guards):

```bash
cd /e/Tunhuabinhnham-integration && RUN_LIVE_CMS_E2E=true E2E_RUN_PYTEST_LIVE=true E2E_SECRETS_ENV_FILE='E:\Tunhuabinhnham\apps\api\.env' E2E_EXPECTED_REF_FINGERPRINT=cbda20f5bbaa /e/Tunhuabinhnham/.venv/Scripts/python.exe apps/api/scripts/run_live_cms_e2e.py
```

Gate C1 passes only if that run reports `PASS` and the independent read-only cleanup check is clean. The permanent admin (Phase 6) and the brand correction (Phase 7) are still blocked on the owner.
