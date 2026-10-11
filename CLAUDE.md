# Repository guidance

Không commit secrets. Không tự ý deploy hoặc push. Public data phải loại unpublished và soft-deleted records; mọi admin mutation phải được FastAPI xác thực và phân quyền.

## Project Discovery

- Default branch: `main`
- Docs: `docs/`
- Layout: `apps/web/` (Next.js public site and admin CMS); `apps/api/` (FastAPI service); `supabase/` (PostgreSQL migrations and seed)
- Repository root is orchestration only; there are two runtime projects.
- `supabase/migrations/` is canonical. `supabase/supabase_product_showcase_sql/` is legacy/manual SQL and must not be applied without a reviewed incremental migration.

### Web

- Root: `apps/web/`
- Language: TypeScript (strict)
- Package manager: npm workspace; root `package-lock.json`
- Frameworks: Next.js 15 App Router, React 19, Tailwind CSS 4, TanStack Query, Supabase SSR, Vitest, Playwright
- Install: `npm install`
- Test: `npm --workspace apps/web test`
- Lint: `npm --workspace apps/web run lint`
- Build: `npm --workspace apps/web run build`
- Cloudflare build: `npm --workspace apps/web run build:cloudflare`
- Dev: `npm run dev:web`

### API

- Root: `apps/api/`
- Language: Python 3.11+
- Frameworks: FastAPI, Pydantic v2, SQLAlchemy 2, Alembic, Pytest
- Install: `pip install -e "./apps/api[dev]"`
- Test: `python -m pytest apps/api/tests`
- Unit tests without external services: `python -m pytest apps/api/tests -m "not integration_supabase"`
- Real Supabase read-only check: `python -m pytest apps/api/tests/test_supabase_integration.py -m integration_supabase`
- Lint: `python -m ruff check apps/api`
- Typecheck: `python -m mypy apps/api/app`
- Dev: `npm run dev:api`
