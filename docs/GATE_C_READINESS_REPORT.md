# Gate C readiness report

Ngày xác minh trực tiếp: 2026-10-11.

## Trạng thái

| Gate | Trạng thái |
|---|---|
| CODE_READY | PASS |
| LOCAL_VERIFIED | PASS |
| LIVE_SUPABASE_VERIFIED | PASS ở revision `0003`; audit hardening còn finding |
| SECURITY_HARDENING | BLOCKED chờ `0004` approval và dependency decision |
| RENDER/CLOUDFLARE_DEPLOYMENT | NOT STARTED |
| PRODUCTION_VERIFIED | NOT STARTED |

## Thay đổi Gate B.1

- Thêm canonical migration/Alembic revision `0004`, live audit script và security regression tests.
- Siết log redaction, database pool/prepared-statement option, admin cache headers và same-origin logout.
- Hạ pool Render 512 MB xuống 3 + 1, giữ một worker, auto-deploy off, không tạo Render PostgreSQL/disk.
- Nâng Vitest lên `5.0.3`; cập nhật lockfile.
- Mở rộng `.gitignore`, rà soát 139-file initial manifest và cập nhật runbooks.

Các file thay đổi/tạo trong Gate B.1:

- Security/database: `apps/api/app/core/config.py`, `apps/api/app/core/logging.py`, `apps/api/app/db/session.py`, `apps/api/scripts/audit_supabase_security.py`, `apps/api/tests/test_logging.py`, `apps/api/tests/test_security_migration.py`, `apps/api/tests/test_supabase_integration.py`, `apps/api/alembic/versions/0004_security_hardening.py`, `supabase/migrations/20261011041446_security_hardening.sql`.
- Frontend: `apps/web/src/middleware.ts`, `apps/web/src/app/api/auth/logout/route.ts`, `apps/web/package.json`, `package-lock.json`.
- Runtime/examples: `.gitignore`, `.env.example`, `apps/api/.env.example`, `render.yaml`.
- Docs: `docs/ARCHITECTURE.md`, `docs/RENDER_DEPLOYMENT.md`, `docs/SUPABASE_SETUP.md`, `docs/DEPLOYMENT_CHECKLIST.md`, `docs/INITIAL_COMMIT_MANIFEST.md` và bốn Gate B.1 reports.

## Kiểm thử chạy mới

| Kiểm thử | Kết quả |
|---|---|
| Ruff (`app scripts tests`) | PASS |
| mypy strict (`app scripts tests`) | PASS — 40 files |
| Pytest | PASS — 30 passed, 2 integration tests skipped by default |
| Security regression subset | PASS — 18 passed |
| Live Supabase read-only integration | PASS — 1 passed, revision `0003` |
| Security migration disposable | PASS — `0001 -> 0004`, grants/RLS synthetic checks pass |
| `pip-audit requirements.lock` | PASS — no known vulnerabilities |
| ESLint | PASS |
| TypeScript | PASS |
| Vitest 5 | PASS — 1 passed |
| Next.js production build | PASS — Next `15.5.27` |
| OpenNext Worker build | PASS — OpenNext `1.20.9`; Windows warning retained |
| Playwright local | PASS — 4 public desktop/mobile; 4 real-CMS cases skipped by explicit write gate |
| Local smoke | PASS — homepage, admin login và API liveness đều HTTP 200 |
| npm production audit | FAIL gate — 1 High + 1 Moderate |
| npm full audit | FAIL gate — 6 High + 1 Moderate; 0 Critical |

Pytest có một Starlette warning về `httpx`/`httpx2`; không làm sai kết quả nhưng cần theo dõi upstream. Playwright lần này không được trình bày là Real CMS E2E vì credential/write gate không bật; kết quả Real CMS 2 passed thuộc Gate B trước đó.

## Render readiness

Start command bind `0.0.0.0:$PORT`, một worker, graceful shutdown 30 giây và readiness path đúng. Render không có Sydney; Singapore là region khả dụng gần Supabase Sydney nhất về địa lý, nhưng phải đo latency từ service thật trước DNS/cutover. Region Render là immutable nên quyết định cuối phải có dữ liệu median/p95.

Render persistent backend nên dùng Supabase Shared/Session Pooler 5432 qua IPv4; prepared statements được giữ. Transaction Pooler 6543 chỉ dùng với `DB_DISABLE_PREPARED_STATEMENTS=true` và kiểm tra lại pool semantics. Tham khảo [Supabase connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [psycopg prepared statements](https://www.psycopg.org/psycopg3/docs/advanced/prepare.html), [Render regions](https://render.com/docs/regions) và [Blueprint spec](https://render.com/docs/blueprint-spec).

## Cloudflare readiness

Next/App Router build và OpenNext Worker artifact pass; middleware hiện chỉ dùng Web APIs. Public cache và admin private/no-store được tách. OpenNext Node runtime tiếp tục là đường triển khai đã khóa, theo [OpenNext Cloudflare](https://opennext.js.org/cloudflare) và [Cloudflare OpenNext guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/). Worker preview/deployed cookie flags, cache invalidation và real custom-domain CORS vẫn cần Gate C verification.

## Production security review

- CORS dùng allowlist cấu hình; unit regression kiểm tra allowed/disallowed origin, preflight Authorization và 401 response. Domain thật chưa được cấu hình vì chưa deploy.
- FastAPI admin dùng Bearer token và server-side `admin_users`; route logout cookie đã có same-origin check. Thuộc tính cookie thực tế vẫn phải kiểm tra trên HTTPS Worker.
- Admin response không shared-cache; public endpoint chỉ cache nội dung published với TTL ngắn. Cross-origin logout local trả 403 và `/admin` redirect có `private, no-store` + `Vary: Cookie`.
- Storage mutation chỉ qua backend/service key, có bucket/MIME/size/reference checks; browser bundle không nhận service key. Live Storage/RLS workflow đã PASS ở Gate B nhưng không được chạy lại bằng synthetic writes trong Gate B.1.
- Logger có redaction regression; app không log request body/header secret.
- Rollback dùng version redeploy, không Alembic downgrade. Backup cũ được giữ ngoài repository; cần snapshot mới và restore plan ngay trước `0004`.

## Blockers và approval cần có

1. Duyệt initial commit (hiện chưa commit/push), sau đó cho phép branch thử Next 16 hoặc chấp nhận rủi ro PostCSS có thời hạn. High production dependency chưa được waive.
2. Approval riêng để tạo/xác minh backup mới và áp dụng migration `0004` lên Supabase live. Không chạy migration trước approval.
3. Approval tạo Render Starter/Cloudflare deployment; sau đó đo Singapore-to-Sydney latency và Worker preview thật. Không tạo tài nguyên, deploy, đổi DNS hoặc bật auto-deploy trong báo cáo này.

Kết luận: code và local regression sẵn sàng, nhưng **Gate C chưa được mở** vì dependency High và live security migration còn chờ quyết định của owner.
