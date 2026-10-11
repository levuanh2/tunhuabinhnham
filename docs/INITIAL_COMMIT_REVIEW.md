# Initial commit review — Gate B.1

Status: **PREPARED — NOT COMMITTED**.

Repository chưa có commit đầu tiên. `git ls-files --others --exclude-standard` sau hardening và trước khi tạo bốn báo cáo Gate B.1 cho thấy 135 candidate files; sau khi thêm các deliverable, manifest dự kiến là 139 files. Phải chạy lại lệnh ngay trước khi owner duyệt commit.

## Secret và dữ liệu audit

- Quét toàn bộ candidate source bằng pattern private key, credentialed PostgreSQL URL, JWT và Supabase secret/service key: không thấy secret thật.
- Hai match duy nhất là placeholder `<password>` trong `.env.example`.
- `apps/api/.env` và `apps/web/.env.local` tồn tại local nhưng bị ignore; không nằm trong manifest.
- Test fixtures chỉ dùng `example.com`/`.invalid`, số điện thoại/địa chỉ placeholder, UUID/JWT tổng hợp. Không thấy dữ liệu khách hàng, sản phẩm thật hoặc tài khoản thật.
- `supabase/seed.sql` là dữ liệu development và không được gắn vào production migration/deploy.

## Include

- Source frontend/backend, tests, scripts, CI và deployment config.
- `package-lock.json`, `apps/api/requirements.lock`, `skills-lock.json`.
- Canonical `supabase/migrations/0001..0004` (tên timestamp thực tế) và Alembic wrappers tương ứng.
- `.env.example` ở root/backend/frontend và `.dev.vars.example`, không có giá trị production.
- Tài liệu architecture, runbook, audit và gate reports.
- Legacy SQL chỉ để audit history; tài liệu ghi rõ không phải migration source of truth.

## Exclude

`.env*` trừ examples, `.venv`, `node_modules`, `.next`, `.open-next`, `.wrangler`, `.npm-cache`, Python/test caches, coverage, logs, Playwright artifacts, backup/dump/database local và `supabase/.temp` đều được ignore. Backup live nằm ngoài repository.

## Review trước commit

```powershell
git ls-files --others --exclude-standard
git status --short --ignored
git diff --check
```

Sau đó review riêng `.env.example`, migrations, `render.yaml`, workflow và lockfiles. Chưa `git add`, commit, push hoặc merge trong Gate B.1.
