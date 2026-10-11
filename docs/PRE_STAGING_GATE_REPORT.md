# Pre-staging gate report

Date: 2026-10-10

Overall status: **CODE_READY / LOCAL_VERIFIED / BLOCKED_EXTERNAL_CONFIGURATION**

`STAGING_VERIFIED` and `PRODUCTION_VERIFIED` are not claimed.

## Gate summary

| Area | Status | Evidence |
|---|---|---|
| Git and secret audit | PASS | 125 initial-commit candidates after adding the Gate B report; local secrets/build outputs ignored; targeted secret scan found no private keys, database URLs with credentials, JWTs, Supabase secret keys or Cloudflare tokens in committable files. |
| Backend unit/local integration | PASS | 26 passed; one real-Supabase test deselected. |
| Frontend static checks | PASS | ESLint and TypeScript passed. |
| Frontend unit tests | PASS | Vitest: 1 test passed. |
| Next.js production build | PASS | 19 routes generated; dynamic product/article/admin routes retained. |
| OpenNext Worker build | PASS | Worker bundle generated with `@opennextjs/cloudflare` 1.20.9. |
| Worker local preview | PASS | `/`, `/san-pham`, `/tin-tuc`, `/admin/login`, `/robots.txt`, `/sitemap.xml` returned HTTP 200. |
| Playwright local | PASS | 4 public desktop/mobile checks passed. |
| Real staging CMS E2E | BLOCKED | 4 staging test variants skipped: no approved staging URL/API, admin credentials or write approval. |
| Supabase migration/security integration | BLOCKED | Available database is not confirmed disposable/staging and remains at revision `0001`; no writes were performed. Docker Desktop was unavailable for a local Supabase stack. |

## Changed files in this phase

- Git/security: `.gitignore`, `docs/INITIAL_COMMIT_MANIFEST.md`.
- Backend: `apps/api/app/api/v1/admin.py`, `apps/api/app/models/entities.py`, `apps/api/tests/test_media_validation.py`, `apps/api/tests/test_supabase_integration.py`.
- Migrations: `supabase/migrations/202610100003_foreign_key_indexes.sql`, `apps/api/alembic/versions/0003_foreign_key_indexes.py`.
- CI: `.github/workflows/ci.yml`.
- Media/CMS foundation: `apps/web/src/lib/admin-media.ts`, `apps/web/src/components/admin-media-upload.tsx`, `apps/web/src/lib/admin-api.ts`, `apps/web/src/types/api.ts`.
- CMS pages: article, banner, settings, category and product management pages plus `apps/web/src/features/admin/product-form.tsx`.
- Public rendering: public layout, site header and homepage banner rendering.
- Cache invalidation: `apps/web/src/app/api/revalidate/route.ts`.
- E2E: `apps/web/playwright.config.ts`, `apps/web/e2e/staging-cms.spec.ts`.

No production deployment, DNS change, commit, push, merge, paid-resource creation or production Supabase write was performed.

## Security findings

- `.env` files, local databases, agent tooling, Supabase CLI state and generated artifacts are ignored. Production values were not printed or copied.
- Committable-file scanning found no private key block, credential-bearing PostgreSQL URL, Supabase `sb_secret_` value or JWT-shaped token.
- Test data uses `example.com`, placeholders and synthetic identifiers only.
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities. `pip check`: no broken requirements.
- Uploads are authorized through admin-only FastAPI routes. The browser never receives the Supabase secret/service-role key.
- Upload validation enforces bucket allowlisting, MIME allowlisting, file size and magic-byte checks. Object names are generated UUID paths.
- Deletion rejects referenced media. Replacement updates content first and then attempts Storage cleanup, preventing broken live references when saving fails.
- Public cache invalidation now requires a valid Bearer token accepted by a protected backend admin endpoint. Authenticated/admin data remains `no-store`.
- Remaining external checks: real RLS behavior, ordinary-user denial, JWT expiry/refresh and Storage mutation denial must be exercised against an approved staging project.

## Migration review

### Source of truth

`supabase/migrations/*.sql` is the canonical schema source. Alembic revisions are thin, ordered execution/version wrappers around those exact SQL files. A schema change must be authored once in canonical SQL and referenced by one Alembic revision; it must not be duplicated independently.

`supabase/supabase_product_showcase_sql/` is legacy reference material only. It must not be applied alongside Alembic/canonical migrations.

### Revision findings

- `0001`: creates the base schema, RLS read policies, explicit Data API read grants and four public Storage buckets. No table/data drop exists. Trigger and policy replacement is metadata-only. It does not grant anon/authenticated table writes or define client Storage write policies.
- `0002`: incrementally creates `post_images` with `ON DELETE CASCADE`, unique storage key, unique `(post_id, sort_order)`, non-negative order check, FK index, update trigger and RLS read limited to published/non-deleted parent posts. Only `SELECT` is granted to anon/authenticated.
- `0003`: adds three missing FK-supporting indexes using only `CREATE INDEX IF NOT EXISTS`.
- Downgrades intentionally raise instead of dropping schema/data.
- Idempotency is defensive, not a substitute for migration versioning: `IF NOT EXISTS` does not repair a partially divergent existing table. Apply each revision exactly once through Alembic after drift review.
- Read-only inspection found the available Supabase database at `0001`; therefore `0002` and `0003` are pending. They were not applied because that project is not confirmed as staging/disposable.

## CMS completion

- Articles: multiple real Storage uploads, previews, alt text, cover selection, replacement/removal, draft/published editing, empty/loading/error states.
- Banners: real upload, preview, replace/remove, active/order/CTA editing, public homepage image rendering.
- Branding: logo/favicon upload, preview, replace/remove, MIME/size feedback; public header and metadata consume saved values.
- Products: category selection and safe Storage cleanup were added to the existing multi-image workflow.
- Admin forms are responsive and expose pending/success/error/empty states for the completed areas.
- Mutations request authenticated tag invalidation so public catalogue content updates without waiting for the normal 60-second TTL.

## Verification results

| Check | Result |
|---|---|
| Ruff | PASS |
| mypy strict | PASS |
| Pytest unit/local | PASS — 26 passed |
| Real Supabase pytest | NOT RUN — explicitly gated by `RUN_SUPABASE_INTEGRATION=true` |
| ESLint | PASS |
| TypeScript | PASS |
| Vitest | PASS — 1 passed |
| Next.js production build | PASS |
| OpenNext Worker build | PASS; Windows compatibility warning remains, CI Linux is authoritative |
| Playwright local/mock-public | PASS — 4 passed |
| Playwright real staging | NOT RUN — 4 skipped |
| Dependency checks | PASS — npm production audit 0; pip dependency graph valid |
| Secret scan | PASS for committable files |

## Remaining blockers

1. Provide or approve a disposable/staging Supabase project and confirm it is not production.
2. Configure staging database URL, Supabase URL/publishable/secret keys, a normal test user and a verified admin test user through secret storage.
3. Apply `0001..0003` to that staging project only, then run the read-only schema/RLS test and the write-security matrix.
4. Configure a staging Render service and Cloudflare Worker/custom preview domain; no paid resource should be created until approved.
5. Run real CMS E2E with `E2E_BASE_URL`, `E2E_API_URL`, `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`, and `E2E_ALLOW_STAGING_WRITES=true` only after explicit staging-write approval.
6. Validate expired JWT/session refresh and ordinary-user admin denial using real Supabase sessions.
7. Review and approve the 125-file initial commit manifest; the repository is still uncommitted.

## Required approvals

- Approval to treat a named Supabase project as staging/disposable and apply migrations there.
- Approval to write/delete synthetic E2E records and Storage objects in that staging project.
- Approval to create/configure staging Render and Cloudflare resources, including encrypted secrets and staging domains.
- Separate approval before any initial commit, push/merge, production deployment, DNS change or production policy/migration operation.

Until those approvals and credentials are supplied, the honest gate remains **BLOCKED_EXTERNAL_CONFIGURATION** after **LOCAL_VERIFIED**.
