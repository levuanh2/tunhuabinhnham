# Kiểm thử và quality gates

## Kết quả gần nhất — 2026-10-10

| Gate | Kết quả | Evidence |
|---|---|---|
| Backend Ruff | PASS | `python -m ruff check apps/api` |
| Backend unit/API | PASS | 26 tests, Supabase integration excluded |
| Supabase integration thật | `BLOCKED_EXTERNAL_CONFIGURATION` | DB hiện có đã xác minh ở `0001`; contract mới cần `0002` và `0003`, chưa được phép apply |
| Alembic history | PASS | `0003 (head)`; migration tăng dần, không có DROP TABLE |
| Backend mypy | PASS | 20 source files, strict mode |
| Frontend ESLint | PASS | 0 warning/error |
| Frontend TypeScript | PASS | `tsc --noEmit` |
| Frontend component | PASS | 1 Vitest test |
| Frontend build | PASS | Next.js 15.5.27, 19 routes |
| Frontend E2E local | PASS | 4 Playwright tests, desktop + mobile |
| Frontend E2E staging | `BLOCKED_EXTERNAL_CONFIGURATION` | 4 workflow/viewport variants skipped without approved staging writes |
| API smoke | PASS | live 200, ready 200, Authorization preflight 200 |
| OpenNext Worker build | PASS | OpenNext 1.20.9; Wrangler preview 6 routes đều HTTP 200 |

## Commands

```sh
python -m pytest apps/api/tests -m "not integration_supabase"
$env:RUN_SUPABASE_INTEGRATION="true"
python -m pytest apps/api/tests/test_supabase_integration.py -m integration_supabase
python -m alembic -c apps/api/alembic.ini check
npm run lint
npm --workspace apps/web run typecheck
npm test
npm run build
npm run test:e2e
npm run build:cloudflare
```

Chỉ chạy workflow CMS thật sau khi xác nhận project staging/disposable:

```powershell
$env:E2E_BASE_URL="https://staging.example.com"
$env:E2E_API_URL="https://api-staging.example.com/api/v1"
$env:E2E_ADMIN_EMAIL="staging-admin@example.com"
$env:E2E_ADMIN_PASSWORD="<secret>"
$env:E2E_ALLOW_STAGING_WRITES="true"
npm --workspace apps/web run test:e2e
```

Không đổi integration test thành mock. Thiếu credentials phải báo `BLOCKED_EXTERNAL_CONFIGURATION` hoặc skip có lý do rõ ràng.
