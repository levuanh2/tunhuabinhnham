# Gate B — Live Supabase integration report

Date: 2026-10-11

Overall status: **CODE_READY: PASS / LOCAL_VERIFIED: PASS / LIVE_SUPABASE_VERIFIED: PASS / PRODUCTION_DEPLOYMENT_NOT_STARTED**

The project owner authorized using the existing Supabase project for migrations `0002`–`0003` and controlled synthetic testing. No Render/Cloudflare deployment, DNS change, commit, push or merge was performed.

## Gate summary

| Area | Result | Evidence |
|---|---|---|
| Project identity | PASS | Backend and frontend resolved to the same approved project; redacted project-ref fingerprint `cbda20f5bbaa`. |
| Backup | PASS | Pre-migration roles, schema and data dumps exist outside the repository and the public schema/data restore was verified in an isolated PostgreSQL container. |
| Migrations | PASS | Alembic executed canonical Supabase SQL exactly once in order: `0001` → `0002` → `0003`. Final revision is `0003`. |
| Schema drift | PASS | No missing or unexpected application tables, expected indexes, FKs, enums, RLS policies and buckets verified. |
| Real Auth/RLS/Storage integration | PASS | Synthetic anon, non-admin and admin checks ran against the real Supabase APIs and backend. |
| Real CMS browser E2E | PASS | Playwright desktop suite: `2 passed (2.7m)` against local Next.js + FastAPI connected to Supabase. |
| Cleanup | PASS | Zero `__e2e_` residue in application content, Auth and Storage; original settings/banner state restored. |
| Local regression | PASS | Ruff, mypy strict, Pytest, ESLint, TypeScript, Vitest, Next production build and OpenNext Worker build passed. |
| Production deployment | NOT STARTED | Render, Cloudflare, DNS and production-domain validation require separate approval. |

## Backup and restore plan

Backup directory, outside Git: `E:\Tunhuabinhnham-backups\20261010_gate_b_pre_0002`

| File | SHA-256 |
|---|---|
| `roles.sql` | `168A95A9C745AF5ED4679751F90419AC9DC434240A213B03E32A06D5664C2308` |
| `schema.sql` | `855CC1F4F8CCF88E67E6B5EDF1687246D6EBD9823AD511CA7C65A6E5E12E998D` |
| `data.sql` | `5933C23B4DC855542B5C214F1B82E7CA8261371D57C2C000373EF10978938C75` |

The application schema and data restored successfully in an isolated Supabase PostgreSQL image and matched the source baseline (`alembic_version=0001`, two categories, one site-settings row). Hosted `auth.users` and `storage.objects` were empty before migration. Supabase database dumps do not contain Storage object bytes, so a future non-empty recovery requires a separate object backup.

Recovery requires an approved empty Supabase project with compatible managed schemas. Restore roles, schema and data with `ON_ERROR_STOP`; then verify revision, counts, constraints, indexes, RLS, policies and buckets before enabling traffic. Never restore these dumps over the current project without a separate incident approval.

## Migration audit and result

The canonical schema source is `supabase/migrations/*.sql`. Alembic is the only execution/versioning path; the SQL migrations were not also run through the Supabase CLI or dashboard.

- `0002` creates `post_images`, its cascade FK, unique constraints, non-negative sort order, update trigger, index, RLS and published-parent read policy.
- `0003` creates the three missing FK-supporting indexes using `CREATE INDEX IF NOT EXISTS`.
- PostgreSQL transactional DDL applied both upgrades successfully.
- No `DROP`, reset, truncate, seed or destructive update was used.
- Post-migration revision is `0003`; baseline data counts were preserved.

Final database inventory: 11 application tables plus `alembic_version`; all 11 application tables have RLS enabled; seven expected public-read policies and four media buckets are present; no unexpected public table or policy was found.

## Authentication and authorization verification

Real integration checks passed for:

- Unauthenticated admin API denial (`401`).
- Authenticated non-admin denial (`403`).
- Admin identity and CRUD authorization through trusted `admin_users` data.
- Token signature/tampering rejection and expired-token handling.
- Session refresh.
- Allowed and disallowed CORS origins, preflight and Authorization headers.
- PostgREST anonymous and ordinary authenticated writes denied by RLS.
- No browser exposure of the Supabase server secret.

Logout was hardened during browser verification. A server route now signs out the Supabase SSR session and expires only `sb-*-auth-token` cookies. Middleware now protects both exact `/admin` and nested admin paths; the previous matcher omitted exact `/admin`.

## Storage and CMS verification

Real Supabase Storage checks passed for `product-images`, `post-images`, `banners` and `branding`:

- Admin upload/download/delete.
- Anonymous and non-admin upload denial.
- Unauthorized deletion denial.
- MIME and size validation.
- Product multi-image, post cover/media, banner, logo and favicon workflows.
- Replacement/removal and orphan cleanup.

The real browser workflow verified:

1. Admin login and protected routes.
2. Category creation.
3. Product creation with multiple images.
4. Publish and public API/page visibility.
5. Facebook/Messenger CTA destination without sending a message.
6. Product update, cache invalidation and hide behavior.
7. Post creation with cover/media and public article visibility.
8. Banner creation and homepage visibility.
9. Logo/favicon upload and settings persistence.
10. Settings restoration, media cleanup, logout and access denial.

Fixes made from real E2E findings:

- Await public cache revalidation after admin mutations and invalidate catalog tags/paths.
- Await category query invalidation before asserting new UI state.
- Prevent settings submission while logo/favicon upload is still in progress.
- Add server-side Supabase logout and protect exact `/admin`.
- Snapshot and restore existing settings/banner state in the E2E harness.
- Delete only contact clicks, records, media objects and accounts belonging to the current run.

## Cleanup verification

The final read-only audit reported:

| Inventory | Count |
|---|---:|
| Synthetic categories/products/posts/banners | 0 |
| Synthetic Auth users | 0 |
| Synthetic Storage objects | 0 |
| `admin_users` / `audit_logs` / `media_assets` | 0 / 0 / 0 |
| Hosted `auth.users` / `storage.objects` | 0 / 0 |
| Preserved categories / contact clicks / site settings | 2 / 2 / 1 |

The two contact-click rows were part of the pre-test baseline; current-run contact clicks are deleted by exact synthetic product IDs. The final revision remained `0003` and no schema drift was found.

## Verification results

| Check | Result |
|---|---|
| Ruff | PASS |
| mypy strict | PASS |
| Pytest local | PASS — 26 passed, 2 explicitly gated/skipped |
| Real Supabase read-only integration | PASS |
| Real Supabase Auth/RLS/Storage/CMS integration | PASS — 1 passed in 91.39s |
| Real CMS Playwright | PASS — 2 passed in 2.7m |
| ESLint | PASS |
| TypeScript | PASS |
| Vitest | PASS — 1 test |
| Next.js production build | PASS — 20 routes generated/validated |
| OpenNext Worker build | PASS — `.open-next/worker.js` generated |
| Python dependency audit | PASS — no known vulnerabilities in `requirements.lock` |
| npm production audit | OPEN — 1 high and 1 moderate finding in Next 15's transitive PostCSS; automated fix requires breaking Next 16.4 upgrade |
| `git diff --check` | PASS |
| Initial commit manifest | PREPARED — 130 untracked, non-ignored candidates; no commit authorized |

OpenNext emits a Windows compatibility warning. The bundle succeeded, but a Cloudflare local Worker preview and deployed Worker smoke test are still required before deployment verification.

## Changed files in this continuation

- `apps/api/scripts/preflight_live_supabase.py`: redacted schema/inventory and synthetic-residue audit.
- `apps/api/scripts/run_live_cms_e2e.py`: temporary admin orchestration, service reuse, settings/banner snapshot and exact cleanup.
- `apps/api/tests/test_live_supabase_gate.py`: real Auth, RLS, Storage, CORS and CMS integration suite.
- `apps/web/e2e/staging-cms.spec.ts`: real browser CMS workflow with unique run IDs and safe CTA validation.
- `apps/web/playwright.config.ts`: realistic E2E/expect timeouts.
- `apps/web/src/app/api/auth/logout/route.ts`: server-side Supabase SSR logout and cookie expiration.
- `apps/web/src/app/api/revalidate/route.ts`: authenticated catalog tag/path invalidation.
- `apps/web/src/lib/admin-api.ts`: awaited cache invalidation after successful mutations.
- `apps/web/src/middleware.ts`: exact `/admin` route protection.
- `apps/web/src/components/admin-shell.tsx`: hardened logout flow.
- `apps/web/src/components/admin-media-upload.tsx`: upload busy-state propagation.
- `apps/web/src/app/admin/(cms)/cai-dat/page.tsx`: block save during branding upload and improve states.
- `apps/web/src/app/admin/(cms)/danh-muc/page.tsx`: await category cache refresh.
- `docs/INITIAL_COMMIT_MANIFEST.md`: candidate count refreshed.
- `docs/GATE_B_LIVE_SUPABASE_REPORT.md`: this final evidence report.

Other Gate B preparation files documented earlier remain part of the uncommitted initial baseline.

## Remaining blockers and next approval

1. Review or formally accept the Next 15/PostCSS advisory, or schedule a separate Next 16 + OpenNext compatibility upgrade.
2. Run Cloudflare Worker preview in the intended Linux/CI environment and perform a deployed staging smoke test.
3. Configure Render and Cloudflare secrets/custom domains only after explicit deployment approval.
4. Validate the deployed Render health/readiness endpoints, Worker SSR/auth/cache behavior and real custom-domain CORS.
5. Review the 130-file initial commit manifest. No commit, push or merge has been performed.

This gate claims **LIVE_SUPABASE_VERIFIED**, not `STAGING_VERIFIED` and not `PRODUCTION_VERIFIED`. Production deployment and production-domain verification have not started.
