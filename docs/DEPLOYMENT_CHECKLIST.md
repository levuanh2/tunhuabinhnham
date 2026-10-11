# Deployment checklist

## Gate trước khi tạo tài nguyên

- [ ] PR reviewed; GitHub CI xanh.
- [ ] Không có `.env`, password, token, database URL thật trong diff/history.
- [ ] Xác nhận database live đang ở `0003`; tạo và xác minh backup mới trước khi xin phép áp dụng `0004`.
- [ ] Sau approval riêng, `alembic current` là `0004 (head)` và kiểm tra lại grants, RLS, policies, `set_updated_at.search_path`.
- [ ] Backup/PITR Supabase phù hợp được xác nhận.
- [ ] Domain thật, canonical host, Render/Cloudflare account và budget được phê duyệt.
- [ ] Render Blueprint diff không tạo PostgreSQL/disk; auto-deploy vẫn off.
- [ ] Đo latency từ Render Singapore tới Supabase Sydney trước cutover; ghi lại median/p95 và quyết định region.
- [ ] Cloudflare production auto-deploy vẫn off cho tới approval.

## Backend staging/production

- [ ] Cấu hình secrets dashboard, không đưa vào YAML.
- [ ] `/health/live` 200 khi DB down; `/health/ready` 503 khi dependency lỗi và 200 khi bình thường.
- [ ] Swagger hoạt động, production error không lộ trace/secrets.
- [ ] Allowed/disallowed origin và Authorization preflight đúng.
- [ ] JWT hợp lệ + admin active qua `/api/v1/auth/me`; expired/invalid token 401; non-admin 403.
- [ ] Product/category/post/banner/settings CRUD và audit log đúng.
- [ ] Upload ảnh thật vào đúng bucket; URL public; file sai MIME/quá lớn bị chặn.

## Frontend

- [ ] `next build` và OpenNext build pass; Worker size trong giới hạn.
- [ ] Homepage, product list/detail/filter, article list/detail, sitemap, robots, metadata.
- [ ] Admin login/session expiry, product create/update/archive, draft/published visibility.
- [ ] Banner/settings update xuất hiện sau cache window/invalidation.
- [ ] Facebook CTA dùng URL cấu hình, fallback hoạt động, copy SKU/link hoạt động.
- [ ] 360/390/768/1024/1440 không overflow; keyboard/focus/error/loading states.

## Cutover và rollback

- [ ] DNS/certificate kiểm tra trước khi ép HTTPS.
- [ ] Uptime monitor `/health/ready`; alert frontend/API configured.
- [ ] Ghi lại Render deploy ID và Cloudflare Worker version tốt gần nhất.
- [ ] Rollback code/version đã diễn tập; không dùng Alembic downgrade để xử lý incident.
- [ ] Sau launch, kiểm tra 20 luồng trong yêu cầu bằng production thật rồi mới ghi `PRODUCTION_VERIFIED`.
