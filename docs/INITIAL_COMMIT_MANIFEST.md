# Initial commit manifest

Status: **PREPARED — NOT COMMITTED**

The repository has no tracked application baseline yet. After ignore rules are applied, `git ls-files --others --exclude-standard` reports 139 candidate files, including the Gate B/B.1 reports.

## Include

- Root configuration: `.env.example`, `.gitignore`, `CLAUDE.md`, `README.md`, `package.json`, `package-lock.json`, `render.yaml`, `skills-lock.json`.
- CI: `.github/workflows/ci.yml`.
- Backend source, Alembic wrappers, dependency lock, tests and scripts under `apps/api/`, excluding ignored local state.
- Frontend source, public assets, configuration and tests under `apps/web/`, excluding ignored builds, dependencies and local environment files.
- Deployment and operations documentation under `docs/`.
- Canonical migrations under `supabase/migrations/` and the development-only `supabase/seed.sql`.
- Legacy reference SQL under `supabase/supabase_product_showcase_sql/`; it is retained for audit history and is explicitly non-canonical.

Before the initial commit, review the exact list with:

```powershell
git ls-files --others --exclude-standard
git diff --check
```

## Exclude

- `.env`, `.env.*` except committed examples; specifically `apps/api/.env` and `apps/web/.env.local`.
- `.agents/`, `.venv/`, `node_modules/`, Python and test caches.
- `.next/`, `.open-next/`, `.wrangler/`, `test-results/`, `playwright-report/`, `*.tsbuildinfo`.
- `supabase/.temp/`, local SQLite databases and OS/editor artifacts.

## Fixture review

Committed fixtures contain only example domains, placeholder phone/address values, fixed test UUIDs and locally generated test JWTs. No real customer, admin or production credential data was found. `supabase/seed.sql` is development sample data and must never be run as part of production deployment.

No commit, push or merge has been performed.
