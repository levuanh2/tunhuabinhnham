# Kiến trúc triển khai

## Topology

```text
Browser
  -> Cloudflare DNS/WAF/CDN
     -> Cloudflare Worker: Next.js public site + /admin
     -> api.example.com -> Render Web Service: FastAPI
                              -> Supabase PostgreSQL
                              -> Supabase Auth/JWKS
                              -> Supabase Storage
```

Domain là placeholder. `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_API_URL`, `FRONTEND_URL` và `CORS_ORIGINS` là nguồn cấu hình; không hardcode domain production.

## Trust boundaries

- Browser chỉ nhận Supabase URL và publishable key. Database URL và secret key không được đưa vào `NEXT_PUBLIC_*`.
- FastAPI xác minh JWT asymmetric bằng JWKS. Với project legacy HS256, API gọi `/auth/v1/user` bằng publishable key thay vì giữ JWT secret. Sau đó API luôn tra `admin_users` active; role từ request hoặc `user_metadata` không cấp quyền.
- Admin API có limiter in-process theo admin ID, phù hợp cấu hình một Uvicorn worker; Cloudflare WAF vẫn là lớp rate limit phân tán và bảo vệ origin.
- SQLAlchemy dùng server-only `DATABASE_URL`. FastAPI vẫn bắt buộc authorization cho mọi `/api/v1/admin/*`, kể cả khi database role có quyền cao.
- Upload đi qua FastAPI đã xác thực, kiểm tra bucket, kích thước và chữ ký MIME. Object key dùng UUID. Download ảnh public đi trực tiếp Supabase Storage.

## Runtime and data

- `apps/web`: Next.js 15 App Router trên Cloudflare Workers qua OpenNext.
- `apps/api`: FastAPI/Uvicorn, một worker mặc định trên Render 512 MB.
- `supabase/migrations/*.sql` là nội dung migration chuẩn; Alembic là đường thực thi/versioning duy nhất. `0001` tạo schema nền, `0002` thêm `post_images`, `0003` bổ sung hợp đồng media/CMS, và `0004` đề xuất hardening quyền/RLS không phá hủy dữ liệu. Live hiện ở `0003`; `0004` chưa được phép áp dụng.
- Public API chỉ trả nội dung published/visible/chưa soft-delete. Admin response là `no-store`; public GET cache ngắn 60 giây. Không shared-cache response có Authorization.
- `post_images` và `product_images` dùng eager loading để tránh N+1 trên danh sách/detail.

## Operations

- `/health/live` không gọi dependency; `/health/ready` chạy `select 1` với connect timeout ngắn.
- API log JSON ra stdout với request ID, method, path, status và duration; không log token/URL database.
- Engine dùng TLS, `pool_pre_ping`, pool 3 + overflow 1 trên Render 512 MB, pool timeout 10 giây, connect timeout 5 giây và session rollback/cleanup rõ ràng. Render dùng Shared/Session Pooler 5432; Transaction Pooler chỉ dùng sau khi tắt prepared statements và kiểm tra riêng.
- Uvicorn nhận `SIGTERM`; lifespan dispose engine; Render chờ tối đa 30 giây.

## Non-goals

Không có cart, checkout, payment, order service, Render PostgreSQL hoặc persistent filesystem trên Render.
