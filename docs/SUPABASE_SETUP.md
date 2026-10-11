# Supabase production setup

## Database contract

Migration chuẩn nằm trong `supabase/migrations/*.sql`; Alembic chỉ là lớp thực thi/versioning và không được chạy SQL lần thứ hai bằng CLI khác. Database live được đọc-only ở revision `0003`. Migration `0004` hardening quyền/RLS đã được kiểm chứng trên PostgreSQL disposable nhưng chưa được phép áp dụng live. Không chạy lại `0001`, không chạy SQL legacy trong `supabase/supabase_product_showcase_sql/`, và không stamp revision để che drift.

Backend Render dùng connection string lấy nguyên từ Supabase Dashboard. Vì Render outbound qua IPv4, dùng Shared/Session Pooler port 5432 với psycopg + SQLAlchemy QueuePool; `sslmode=require` được ép server-side. Nếu chuyển Transaction Pooler port 6543, đặt `DB_DISABLE_PREPARED_STATEMENTS=true`, kiểm tra transaction semantics và chiến lược pool rồi cập nhật tài liệu; không đoán host/port.

```sh
python -m alembic -c apps/api/alembic.ini current
python -m alembic -c apps/api/alembic.ini history
# Chỉ sau backup + review + approval:
python -m alembic -c apps/api/alembic.ini upgrade head
python apps/api/scripts/verify_supabase.py
```

Chỉ lệnh cuối có thể thay đổi schema. Backup và review SQL incremental trước khi chạy production; không chạy downgrade/reset/seed production.

## Auth/admin đầu tiên

1. Tắt public sign-up nếu catalogue không cần account công khai.
2. Tạo user qua Supabase Dashboard/Auth bằng email đã kiểm soát và yêu cầu password mạnh/MFA nếu plan hỗ trợ.
3. Lấy UUID Auth user rồi chạy bằng SQL Editor với quyền quản trị:

```sql
insert into public.admin_users (auth_user_id, email, role, is_active)
values ('<auth-user-uuid>', '<admin-email>', 'admin', true)
on conflict (auth_user_id) do update
set email = excluded.email, role = 'admin', is_active = true;
```

Không mở endpoint public tạo admin. FastAPI xác minh JWKS/issuer/audience/expiry khi project dùng asymmetric signing key. Với legacy HS256, API xác minh token qua Supabase Auth `/auth/v1/user`; không lưu JWT secret. Mọi request sau đó tra bảng `admin_users`. Login xảy ra trực tiếp qua Supabase Auth; cấu hình rate limits/CAPTCHA ở Auth và Cloudflare WAF.

## Storage

Buckets: `product-images`, `post-images`, `banners`, `branding`. Chúng public cho ảnh đã công bố; mutation chỉ qua backend với secret key. Backend giới hạn 8 MiB, xác minh chữ ký JPEG/PNG/WebP (và ICO chỉ cho branding), bucket allowlist và UUID key. Xóa object chỉ được phép khi database không còn reference. Không ghi file lên Render.

Khi thay/xóa media, UI phải gỡ reference trước; `DELETE /api/v1/admin/media/{id}` từ chối object còn được product/post/banner/category/branding tham chiếu. Chưa bật job cleanup tự động để tránh xóa nhầm dữ liệu; batch cleanup cần dry-run và approval.

## Verification

```sh
python apps/api/scripts/check_connection.py
python apps/api/scripts/verify_supabase.py
python -m pytest apps/api/tests/test_supabase_integration.py -m integration_supabase
```

Các lệnh trên read-only. Không in `DATABASE_URL` hoặc key vào log/screenshot.
