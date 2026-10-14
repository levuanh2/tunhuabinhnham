# Deploy FastAPI lên Render

## Trạng thái an toàn

`render.yaml` dùng runtime Python, region Singapore, plan ID `0.5c-512mb` (tên cũ Starter), một worker, health path `/health/ready` và `autoDeployTrigger: off`. Blueprint không tạo PostgreSQL và không chứa secret. Không có pre-deploy migration để tránh thay đổi database ngoài ý muốn.

## Tạo service (thao tác dashboard thủ công)

1. Commit/push sau khi review và bảo đảm CI xanh.
2. Render Dashboard → New → Blueprint → chọn repository và đọc diff tài nguyên trước khi Apply.
3. Xác nhận service `tunhuabinhnham-api`, Singapore, `0.5c-512mb`; không thêm Render PostgreSQL/disk.
4. Nhập secret/value bị `sync: false`:
   - `DATABASE_URL`: Supabase **Shared/Session Pooler (port 5432)** URL lấy từ Dashboard, password đã percent-encode, TLS. Render chỉ có outbound IPv4 nên không dùng Direct Connection IPv6-only.
   - `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`.
   - `SUPABASE_JWT_ISSUER=https://<project-ref>.supabase.co/auth/v1`.
   - `SUPABASE_JWKS_URL=https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`.
   - `CORS_ORIGINS=https://example.com` (thêm `https://www.example.com` bằng dấu phẩy chỉ nếu host đó thực sự chạy app).
   - `FRONTEND_URL=https://example.com`.
5. Trước deploy đầu tiên, chạy read-only `alembic current` và review `alembic history`. Database live được xác minh ở `0003`; `0004` là hardening được đề xuất và **chưa áp dụng**. Chỉ chạy `alembic upgrade head` sau một backup mới, kiểm tra restore, review SQL và approval riêng cho `0004`.
6. Trigger deploy thủ công. Kiểm tra `/health/live`, `/health/ready`, `/docs`, log startup và một public endpoint.
7. Sau khi deployment policy được phê duyệt, đổi Auto-Deploy thành **After CI Checks Pass** (`checksPass`). Giữ `off` cho đến lúc đó.

## Giới hạn lượt nhấn liên hệ (V1.0, không phải secret)

`POST /api/v1/contact-clicks` là endpoint công khai nên có giới hạn trong process (một worker):

| Biến | Giá trị | Ý nghĩa |
|---|---|---|
| `CLIENT_IP_HEADER` | `CF-Connecting-IP` | Header IP khách do Cloudflare (đứng trước onrender.com) đặt và ghi đè. Đây cũng là mặc định trong code |
| `CONTACT_CLICK_LIMIT_PER_MINUTE` | `10` | Mỗi khách (IPv6 gộp theo /64) |
| `CONTACT_CLICK_GLOBAL_LIMIT_PER_HOUR` | `300` | Trần tổng số dòng ghi mỗi giờ, kể cả khi IP bị giả mạo |

- Trước Manual Deploy, đặt và kiểm tra 3 biến trong Render Dashboard → Environment (Blueprint không tự đồng bộ vì auto-deploy tắt). Thiếu biến thì code dùng đúng các mặc định trên.
- Bộ đếm nằm trong RAM: restart hoặc spin-down (Free) sẽ reset. Chạy nhiều worker thì cần store dùng chung (Redis/DB) trước.
- Vượt giới hạn trả `429` + `Retry-After` và không ghi dòng nào. Nút "Nhắn tin để mua" mở Messenger trước, không chờ tracking.
- Smoke sau deploy (chỉ GET): `/health/ready` 200; response có `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security`.

## Region và database pool

Render hiện không có region Sydney. Singapore là lựa chọn gần nhất về địa lý trong các region Render đang công bố, nhưng đây mới là lựa chọn tạm thời. Sau khi được phép tạo service, đo nhiều lần thời gian `select 1` từ Render tới Supabase Sydney trước khi cutover. Region Render không đổi được tại chỗ; nếu latency không đạt, phải tạo lại service ở region đã đánh giá trước khi đổi DNS.

Với một worker/512 MB, cấu hình khởi đầu là pool 3 + overflow 1. Shared/Session Pooler port 5432 hỗ trợ persistent backend và prepared statements, nên để `DB_DISABLE_PREPARED_STATEMENTS=false`. Nếu chủ động chuyển sang Transaction Pooler port 6543, đặt biến này thành `true`, kiểm tra lại transaction semantics và cân nhắc `NullPool`; không chỉ thay hostname/port rồi deploy.

## Commands

Build:

```sh
python -m pip install -r apps/api/requirements.lock && python -m pip install --no-deps ./apps/api
```

Start:

```sh
python -m uvicorn app.main:app --app-dir apps/api --host 0.0.0.0 --port $PORT --workers ${WEB_CONCURRENCY:-1}
```

## Rollback

Render Dashboard → service → Deploys → chọn bản deploy ổn định trước → Redeploy. Không downgrade Alembic trong incident. Nếu release đòi schema mới, migration phải backward-compatible trước khi chuyển traffic; rollback code không được xóa dữ liệu/schema.

Theo dõi restart, readiness 503, pool timeout và slow query trong Supabase Query Performance. Cấu hình uptime monitor tới `/health/ready`; không dùng endpoint admin.
