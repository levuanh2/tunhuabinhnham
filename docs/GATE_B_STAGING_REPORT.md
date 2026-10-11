# Gate B — Supabase staging integration report

Date: 2026-10-10

Overall status: **BLOCKED_EXTERNAL_CONFIGURATION**

`STAGING_VERIFIED` is **not** claimed. No migration, Auth administration, synthetic write, Storage mutation, deployment, DNS change, commit, push or merge was performed.

## Gate summary

| Check | Result | Evidence |
|---|---|---|
| Staging project identity verified | **NO** | Local runtime configuration resolves to one Supabase project ref only. There is no second independently identifiable staging ref. |
| Staging ref differs from production | **NOT VERIFIED** | No staging ref or separately identified production ref was supplied for comparison. |
| Staging database URL verified | **NO** | A database URL exists in the ignored backend environment file, but its project ref cannot be safely resolved from the current connection format and it is not labeled/approved as staging. |
| Staging Supabase URL verified | **NO** | Backend and frontend Supabase URLs match the same single configured project. This is the existing project and cannot be reclassified as staging without explicit confirmation. |
| Staging credentials available | **NO** | No staging/E2E variables exist in the process environment or separate secret file. |
| Staging schema/revision read | **NOT RUN** | Stopped before connecting because independent staging identity could not be established. |
| Migration execution | **NOT RUN** | Gate prerequisite failed. |
| Auth/RLS tests | **NOT RUN** | Gate prerequisite failed. |
| Storage integration | **NOT RUN** | Gate prerequisite failed. |
| Real E2E | **NOT RUN** | Gate prerequisite failed. |

## Phase 1 evidence

Secret values were never printed. Only variable names and SHA-256-derived fingerprints were inspected.

- `apps/api/.env`: present and ignored by Git. It contains the existing backend database/Supabase configuration, including legacy anon/service-role variable names.
- `apps/web/.env.local`: present and ignored by Git. Its Supabase URL fingerprint matches the backend Supabase URL fingerprint.
- Distinct resolvable Supabase project refs across these files: **1**.
- Process environment: no variable name containing `STAGING`, `E2E`, `SUPABASE` or `DATABASE` was present.
- `supabase/config.toml`: missing.
- `supabase/.temp`: contains only the CLI version marker; no linked project ref.
- Git remotes: none.
- GitHub secret inventory: unavailable because the repository has no remote and the existing `gh` login is invalid.

The previously inspected existing project was at Alembic revision `0001`. It is deliberately excluded from Gate B writes because it has not been confirmed as disposable/staging. That prior observation is not evidence of a separate staging environment.

## Migration contract ready for staging

No SQL was executed in this gate attempt.

When an independent staging project is verified, the only approved schema execution path is:

1. Canonical SQL lives in `supabase/migrations/*.sql`.
2. Alembic executes and versions those same files exactly once.
3. Apply `0001`, then `0002`, then `0003` on a new staging database.
4. Do not separately run the SQL files through Dashboard/CLI after Alembic has executed them.
5. Do not stamp/fake a revision without proving the corresponding schema exists.
6. Stop on any destructive statement, unexpected existing object, failed transaction or schema drift.

Current Supabase guidance keeps Data API grants separate from RLS, and Storage write authorization is controlled through `storage.objects` policies. The repository migrations intentionally grant only public reads and reserve mutations for the server-side backend flow:

- [Database migrations](https://supabase.com/docs/guides/local-development/database-migrations)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Storage access control](https://supabase.com/docs/guides/storage/security/access-control)

## Tests not executed

The following results remain **BLOCKED_EXTERNAL_CONFIGURATION**, not failures and not passes:

- Anonymous published-only reads and draft denial.
- Authenticated non-admin CRUD denial.
- Admin CRUD through the FastAPI backend.
- JWT expiry, tampering and backend role validation.
- Privilege-escalation and unauthorized-object tests.
- Storage upload/delete denial for anon and ordinary users.
- Product, post, banner, logo and favicon Storage lifecycle.
- Real Render-connected backend workflow and Cloudflare frontend workflow.
- Cache invalidation and logout/admin API denial on staging.

## Repository baseline

The initial commit manifest remains prepared at `docs/INITIAL_COMMIT_MANIFEST.md`. Local environment files, Supabase CLI state, build output, dependencies and caches remain ignored. No commit was created because explicit commit approval was not provided.

## Required inputs and approval

To resume Gate B, provide all of the following through ignored local files or approved secret storage:

1. A newly created or explicitly designated Supabase staging project ref.
2. The production project ref solely for identity comparison; no production credential is required.
3. Staging `DATABASE_URL`, `SUPABASE_URL`, publishable key and server-only secret key.
4. Staging admin and non-admin synthetic test credentials, or approval to create them with the staging Auth admin API.
5. Explicit approval identifying the staging ref and authorizing these exact writes:
   - Alembic upgrades `0001`, `0002`, `0003`.
   - Synthetic Auth users.
   - Synthetic database records.
   - Synthetic Storage objects and their cleanup.
6. For browser E2E, staging frontend/API URLs or approval to create the Render/Cloudflare staging services after Supabase verification.

Suggested approval wording:

> I confirm Supabase project `<staging-ref>` is staging, is different from production `<production-ref>`, and approve applying Alembic revisions `0001` through `0003` plus creating and deleting synthetic Auth, database and Storage test data on that staging project only.

Until those items are available, Gate B must remain **BLOCKED_EXTERNAL_CONFIGURATION**.
