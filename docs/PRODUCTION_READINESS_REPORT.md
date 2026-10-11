# Production readiness report

Ngày đánh giá: 2026-10-10.

## Status

| Scope | Status | Evidence |
|---|---|---|
| Repository audit | `LOCAL_VERIFIED` | Monorepo Next.js/FastAPI/Supabase; working tree chưa có commit ban đầu và toàn bộ file đang untracked |
| Database hiện tại | `LOCAL_VERIFIED` | Read-only: revision `0001`, 10 RLS tables, 6 policies, 4 buckets; dữ liệu không bị thay đổi |
| Database contract mục tiêu | `CODE_READY` | Alembic head `0002`; migration tăng dần thêm `post_images`; chưa áp dụng lên Supabase |
| FastAPI Render readiness | `LOCAL_VERIFIED` | Ruff pass; mypy pass; 24 unit/API tests pass; health/CORS/auth/media/rate-limit covered |
| Next.js standard build | `LOCAL_VERIFIED` | lint/typecheck pass; Vitest 1/1; production build 18 routes; Playwright 4/4 |
| Cloudflare Worker | `LOCAL_VERIFIED` | OpenNext 1.20.9 build pass; Wrangler local preview trả 200 cho 6 smoke routes |
| GitHub Actions | `CODE_READY` | CI lint/typecheck/test/build/OpenNext/E2E; Supabase check chỉ chạy opt-in; chưa chạy trên GitHub |
| Render/Cloudflare deploy | `BLOCKED_EXTERNAL_CONFIGURATION` | Cần account, domain, secret, budget và explicit approval |
| Staging | `BLOCKED_EXTERNAL_CONFIGURATION` | Chưa có deployment thật |
| Production | `BLOCKED_EXTERNAL_CONFIGURATION` | Không deploy/DNS theo ràng buộc; không phải `PRODUCTION_VERIFIED` |

## Implemented

- Render Blueprint: Python runtime, Singapore, plan `0.5c-512mb`, health path, graceful shutdown, secrets `sync: false`, auto-deploy off và không tạo Render PostgreSQL/disk.
- Python production dependency lock; Uvicorn/SQLAlchemy pool TLS/pre-ping/timeouts; rollback/session cleanup; structured request logs.
- Supabase Auth hỗ trợ JWKS asymmetric và legacy HS256 qua Auth server; quyền admin lấy từ `admin_users`, không từ user metadata.
- CORS explicit allowlist, preflight/Authorization/unauthorized/disallowed-origin tests.
- Supabase Storage upload có bucket allowlist, size/MIME signature, UUID key, compensation khi DB commit lỗi và guarded deletion khi hết reference.
- Nhiều ảnh sản phẩm với sort/primary; form edit giữ nguyên storage key. Migration/model/API `post_images` hỗ trợ nhiều ảnh bài viết mà không phá dữ liệu cũ.
- OpenNext/Wrangler được pin trong lockfile; có `open-next.config.ts`; không phụ thuộc R2 mặc định.
- CTA lấy Messenger/Facebook URL đã validate từ site settings, có fallback và click tracking không chặn navigation.

## Tests and results

- Backend: Ruff pass, mypy pass, `24 passed, 1 deselected` (integration thật tách riêng).
- Supabase trước migration `0002`: read-only integration pass cho contract `0001`; xác nhận 10 tables/10 RLS/4 buckets. Sau khi thêm `0002`, integration mục tiêu sẽ cố ý fail cho đến khi migration được duyệt và áp dụng.
- Frontend: ESLint pass, TypeScript pass, Vitest `1/1`, Playwright `4/4`, Next production build pass.
- Cloudflare: OpenNext build pass; local Wrangler preview trả HTTP 200 cho `/`, `/san-pham`, `/tin-tuc`, `/admin/login`, `/robots.txt`, `/sitemap.xml`.
- npm audit hiện báo 0 vulnerability cho dependency tree đã khóa.

## Unresolved / risks

- Supabase thật vẫn ở `0001`; không deploy backend mới trước khi backup, review và apply `0002` có approval.
- Chưa có staging/production endpoint nên không xác minh custom domain, TLS, WAF, upload thật qua CMS hoặc full production checklist.
- Backend có limiter 120 request/phút theo admin ID cho một worker. Production vẫn cần Cloudflare WAF rate-limit và Supabase Auth CAPTCHA/rate limits; nếu scale nhiều instance, limiter in-process không phải global quota.
- ISR dùng cache mặc định không bền qua isolate/deploy vì chưa phê duyệt R2. Public API/Next cache tối đa khoảng 60 giây.
- CMS hiện có upload nhiều ảnh sản phẩm; các bucket post/banner/branding có API an toàn nhưng UI quản lý media đầy đủ vẫn cần mở rộng nếu operator không dùng API.
- Starlette test client phát deprecation warning với bộ thư viện 2026; không ảnh hưởng test result nhưng cần theo dõi upstream trước lần dependency update tiếp theo.

## Required user actions

1. Review toàn bộ working tree và tạo commit đầu tiên; hiện repository chưa có commit.
2. Backup Supabase, review `202610100002_post_images.sql`, rồi phê duyệt riêng nếu muốn chạy `alembic upgrade head`.
3. Chạy GitHub CI trên PR; không bật production deployment trong PR.
4. Cung cấp domain thật, account/budget và nhập secrets trực tiếp trong Render/Cloudflare dashboards.
5. Tạo staging, chạy checklist 20 luồng; chỉ sau đó mới xin approval production/DNS.
