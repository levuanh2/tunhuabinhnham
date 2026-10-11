# Warm Editorial V2 integration report

## Commits

| Role | Branch | SHA |
|---|---|---|
| Common base | `main` | `2715b8f54d4d4b77f9725ba3b6c3dec0ecb60248` |
| Codex Gate B.2 baseline (READY_WITH_ACCEPTED_RISK) | `fix/postcss-security` | `290897d9d775947605e3bfa8296e54630d7eba64` |
| Claude design | `design/warm-editorial-v2` | `ccc291e` (redesign) + `ff46bf1` (font and save round-trip tests) |
| Integration merge | `integration/warm-editorial-v2` | `b6341ea` = merge of `290897d` + `ff46bf1` (`--no-ff`) |
| **Tested integration commit** | `integration/warm-editorial-v2` | **`2ad72acfdc68829e513235e786eb7bf9d40d8117`** (integration fix, see below) |
| Report commit | `integration/warm-editorial-v2` | the next commit adds only `docs/integration/**` (no code) |
| Next 16 trial (not integrated) | `experiment/next-16-postcss` | `d02336d` (BLOCKED_ENVIRONMENT) |

Worktree: `E:\Tunhuabinhnham-integration`. Nothing was pushed or merged into `main`.

## Merge and conflicts

- `git merge-tree` and the real merge produced **no conflicts**. Codex changed only `docs/` and `apps/api/tests`. Claude changed only `apps/web/src`, `apps/web/e2e` and `docs/design`.
- Codex-owned paths are byte-identical between `290897d` and `2ad72ac`: `package.json`, `package-lock.json`, `apps/web/package.json`, `apps/api/**`, `supabase/**`, `next.config.ts`, `open-next.config.ts`, `wrangler.jsonc`, `src/middleware.ts`, `src/app/api/**`. The lockfile is also identical to the base `2715b8f`.
- The design was preserved: 105/105 integration screenshots match the approved design screenshots pixel for pixel (`FINAL_VISUAL_QA.md`).

## Integration change (Claude-owned)

`2ad72ac` fix(web): `apps/web/src/app/admin/login/page.tsx` maps Supabase "Invalid login credentials" to `Email hoặc mật khẩu không đúng.`. Other Supabase messages pass through unchanged. Also added test 13 and fixed a QA script selector (Next's route announcer also has `role=alert`).

## Files changed relative to the Codex baseline

The design set as listed in `docs/design/CODEX_INTEGRATION_HANDOFF.md`:
- 7 new and 17 modified files in `apps/web/src`
- `apps/web/e2e/{responsive.spec.ts, fixtures/mock-api.mjs, visual-qa/*}` and the layout-agnostic `staging-cms.spec.ts`
- `docs/design/**`

Plus the login fix above. That is 50 non-screenshot paths and 174 design screenshots.

## Test matrix: all run on commit `2ad72ac`

### Web (Claude)

| Check | Result |
|---|---|
| `npm ci --offline` (lockfile identical to base; online `npm ci` stalls in this sandbox) | PASS: 815 packages |
| ESLint `--max-warnings=0` | PASS |
| TypeScript `tsc --noEmit` | PASS |
| Vitest | PASS: 2 files, 4 tests |
| `next build` | PASS |
| `opennextjs-cloudflare build` (OpenNext 1.20.9) | PASS: `.open-next/worker.js` |
| Wrangler preview (`wrangler dev`, workerd, local) | PASS: `/`, `/san-pham`, product detail, `/tin-tuc`, article, `/admin/login` all 200; `/admin` and `/admin/bai-viet` 307 to login |
| Playwright vs `next start` (Chromium desktop + WebKit iPhone 13) | **28 passed, 6 skipped, 0 failed** |
| Playwright vs **Worker** (same suite on workerd) | **28 passed, 6 skipped, 0 failed** |
| Responsive overflow (105 screens, 9 viewports) | PASS: 0 overflow |
| Visual regression vs approved design | PASS: 105/105 pixel-identical |

The 6 skips are 4 real-Supabase staging tests (`staging-cms.spec.ts`, need credentials and write approval), test 2 (phone-only, skipped on desktop), and test 12 (state-mutating, desktop-only).

Covered: overflow at 9 viewports, mobile drawer (scroll lock, Escape, focus return, search focus), grid columns, search, filter sheet and sort, swipe gallery, Messenger allowlist plus sticky CTA, article measure, admin drawer and sidebar, editor validation, media controls, category value, Vietnamese fonts (test 11), save round-trip keeping `category_id` and persisting image `sort_order`/`is_primary` after reload (test 12, **fixture API in memory, not Supabase**), Vietnamese login error (test 13). Admin login, middleware redirect and `/api/revalidate` ran in both Node and Worker runtimes against the fake auth.

### Backend and security (Codex, via Herdr)

| Check | `b6341ea` | `2ad72ac` (final) |
|---|---|---|
| Ruff | PASS | PASS |
| mypy strict (40 files) | PASS | PASS |
| pytest `-m "not integration_supabase"` | 30 passed, 2 deselected | 30 passed |
| Security regression (auth, migration, validation, CORS) | 11 passed | 11 passed |
| pip-audit `requirements.lock` | PASS | PASS |

Codex ran these read-only, with repo-relative paths and an in-memory SQLite test database. Its first attempt with absolute paths showed environment artifacts (Ruff import classification, a mypy internal error, a transient readiness DB override); the repo-relative rerun was clean.

### Dependency security (Codex Gate B.2)

- `npm audit`: 7 findings (6 high, 1 moderate, 0 critical) on the unchanged lockfile.
  - `next@15.5.27 → postcss@8.4.31`: 4 advisories, fix only via Next 16.
  - `braces@3.0.3` through the eslint-config-next toolchain: no patched release.
- Status: **ACCEPTED_RISK until 2026-11-10** (owner decision). Neither item is marked PASS.

## Mock vs real verification

| Area | Verified with | Real-environment status |
|---|---|---|
| Public pages, layout, fonts, responsive | Fixture API | Real DB has 0 products/banners/posts. Not visually verified with real content |
| Admin login, middleware redirect, logout UI | Fake Supabase Auth on localhost | **Real Supabase Auth not exercised** (no credentials) |
| Product save, category retention, `sort_order` | In-memory fixture PATCH | **Real DB write BLOCKED** (no approved snapshot/restore procedure) |
| Media upload/replace/remove, Storage | UI controls only | **BLOCKED**: no real Storage writes |
| Cache invalidation | `/api/revalidate` executed against the fixture | Real backend token verification not exercised |
| Backend, security | Unit/regression suites, in-memory SQLite | Live Supabase integration tests deselected |

No real product, account, media or settings was created or modified. The fixture password `qa-password-123` exists only in the local test fixture and never in any deployable configuration.

## Brand

`site_settings.store_name` is still "Tủ Hòa Bình Nhâm" in Supabase. Nothing is hardcoded over it. Every brand reference reads `store_name`: header, footer, homepage "Về …", About page and admin sidebar.
**CMS update for the owner:** Admin → Cài đặt → Tên cửa hàng → `Tủ Nhựa Bình Nhâm` → Lưu thay đổi. Optionally also update "SEO title mặc định". Root `metadata` already uses the correct brand for the title template.

## Remaining blockers

1. Real Supabase Auth/DB/Storage E2E needs an owner-approved, identity-verified, snapshot-backed procedure.
2. Next 16 trial blocked by `npm ci` stalls in this environment. It must be re-run where the npm registry is reachable, before **2026-11-10**.
3. CMS store name update (owner).
4. Real product photography and content.
