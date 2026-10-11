# Security hardening report — Gate B.1

Ngày kiểm tra trực tiếp: 2026-10-11. Không có thay đổi ghi nào được thực hiện trên Supabase live.

## Supabase live (read-only)

Project hiện ở revision `0003`. Audit trực tiếp xác nhận:

- Tất cả bảng ứng dụng có RLS, riêng `public.alembic_version` chưa bật RLS.
- Supabase default grants đang cho `anon` và `authenticated` toàn bộ table privileges trên 12 bảng public. RLS hiện chặn row access ở các bảng nội bộ không có policy, nhưng grants này không đạt least privilege.
- `admin_users`, `audit_logs`, `contact_clicks`, `media_assets` RLS-enabled và không có public policy. Đây là deny-by-default có chủ đích; không cần tạo policy public.
- `public.set_updated_at()` là `SECURITY INVOKER`, nhưng chưa có `search_path` cố định và `PUBLIC`/client roles vẫn có EXECUTE.

Theo hướng dẫn Supabase, RLS và table grants là hai lớp riêng; function nên cố định `search_path` và thu hồi EXECUTE nếu client không cần gọi trực tiếp: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [database functions](https://supabase.com/docs/guides/database/functions).

## Migration `0004` đề xuất

Canonical SQL: `supabase/migrations/20261011041446_security_hardening.sql`; Alembic wrapper: `apps/api/alembic/versions/0004_security_hardening.py` (`0003 -> 0004`). Alembic là đường thực thi duy nhất.

Migration chỉ:

- bật RLS và thu hồi client grants trên `alembic_version`;
- thu hồi grants của `anon`/`authenticated` trên bảng nội bộ;
- cấp đúng `SELECT` cho các bảng catalogue public, vẫn chịu RLS;
- đặt `set_updated_at` thành invoker với `search_path=''` và thu hồi direct EXECUTE;
- đặt default privileges cho table/function mới thành private.

Không có `DROP`, `TRUNCATE`, DML dữ liệu hay public write policy. Downgrade tự động bị vô hiệu hóa để tránh mở lại quyền rộng trong incident.

## Kiểm chứng migration

Trên PostgreSQL disposable `public.ecr.aws/supabase/postgres:17.11.0.004`, Alembic chạy tuần tự `0001 -> 0004` thành công. Sau `0004`:

- revision là `0004`, `alembic_version` có RLS;
- client roles chỉ còn SELECT trên 7 bảng public và không còn quyền trên bảng nội bộ/revision;
- function có `search_path=""`, client/PUBLIC không EXECUTE;
- synthetic anon chỉ đọc category visible; insert, internal select, revision select và direct function execute đều bị từ chối.

Container disposable đã bị xóa. Static regression tests bảo đảm migration incremental, không destructive và wrapper chỉ thực thi canonical SQL.

Migration **chưa áp dụng live**. Backup Gate B cũ nằm ngoài repository nhưng không phải snapshot mới trước `0004`. Trước khi áp dụng cần approval riêng, tạo backup mới ở revision `0003`, xác minh artifact/restore plan, rồi chạy Alembic một lần và audit lại.

## Hardening trong ứng dụng

- Structured logger che Bearer token, JWT, Supabase secret/service key và password trong PostgreSQL URL; có regression tests.
- Admin responses qua middleware nhận `Cache-Control: private, no-store, max-age=0` và `Vary: Cookie`.
- Logout route từ chối cross-origin POST; FastAPI admin mutation dùng Bearer header nên không phụ thuộc cookie và không tạo CSRF surface kiểu cookie-auth.
- Database pool có `pool_pre_ping`, TLS, timeout; hỗ trợ tắt psycopg prepared statements khi chủ động dùng Transaction Pooler.
- Secret/service key không xuất hiện trong `NEXT_PUBLIC_*`; media mutation tiếp tục chỉ qua backend đã xác thực.

Cookie do Supabase SSR quản lý cần được kiểm tra lại thuộc tính `Secure`/`SameSite` trên Worker deployment thật. Đây là deployed verification, không thể kết luận từ local HTTP.
