# Tủ Nhựa Bình Nhâm

Monorepo website trưng bày sản phẩm và Admin CMS: Next.js (public + admin), FastAPI REST API và PostgreSQL/Auth/Storage trên Supabase. Không có cart, checkout hay payment.

## Chạy local

Yêu cầu: Node.js 22+, npm, Python 3.11+ và Supabase project.

```sh
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
npm ci
python -m venv .venv
# Windows: .venv\Scripts\activate
python -m pip install -e "./apps/api[dev]"
python -m alembic -c apps/api/alembic.ini upgrade head
npm run dev
```

- Web: <http://localhost:3000>
- API: <http://localhost:8000>
- Swagger: <http://localhost:8000/docs>
- Health: <http://localhost:8000/health/live>, <http://localhost:8000/health/ready>

Không commit `.env`, database URL, password hoặc Supabase secret key. Production không tự động deploy từ repository hiện tại.

## Quality gates

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
python -m alembic -c apps/api/alembic.ini check
npm run build:cloudflare
```

Integration Supabase thật được tách rõ:

```sh
python -m pytest apps/api/tests/test_supabase_integration.py -m integration_supabase
```

## Deployment documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Render](docs/RENDER_DEPLOYMENT.md)
- [Cloudflare Workers](docs/CLOUDFLARE_DEPLOYMENT.md)
- [Supabase](docs/SUPABASE_SETUP.md)
- [DNS và CORS](docs/DNS_CORS.md)
- [Deployment checklist](docs/DEPLOYMENT_CHECKLIST.md)
- [Production readiness report](docs/PRODUCTION_READINESS_REPORT.md)

`supabase/migrations/` là database contract chuẩn. Không chạy bộ SQL legacy `supabase/supabase_product_showcase_sql/` hoặc seed trên production.
