# Deploy Next.js lên Cloudflare Workers

## Lựa chọn runtime

Dự án dùng adapter `@opennextjs/cloudflare` cho Workers, không dùng static export hoặc `@cloudflare/next-on-pages`. Cách này giữ App Router SSR, metadata động, middleware auth và image optimization. `wrangler.jsonc` bật `nodejs_compat`; không khai báo R2 vì chưa được phép tạo tài nguyên trả phí/phụ trợ.

Deployment tooling được pin trong `package-lock.json`: OpenNext `1.20.9`, Next.js `15.5.27` và Wrangler `4.149.0` (transitive/peer). `open-next.config.ts` dùng cache mặc định và không tự tạo R2.

## Local

```sh
npm ci
npm run dev:web
npm run build
npm run build:cloudflare
npm --workspace apps/web run preview:cloudflare
```

`next dev` là vòng lặp phát triển. `preview:cloudflare` mới là kiểm tra runtime Workers. Copy `apps/web/.dev.vars.example` thành `.dev.vars`; file này bị ignore.

## Workers Builds / Git integration

Root directory: `apps/web`.

- Install command: `cd ../.. && npm ci`
- Build command: `npm run build:cloudflare`
- Deploy command: `npm run deploy:cloudflare`

Đặt biến ở Production/Preview dashboard:

- `NEXT_PUBLIC_API_URL=https://api.example.com/api/v1`
- `NEXT_PUBLIC_SITE_URL=https://example.com`
- `NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>`

Không nhập Supabase secret/service-role key. Tắt production auto-deploy cho đến khi được phê duyệt. Nếu dùng CI riêng, ưu tiên `upload` để tạo version chưa nhận traffic rồi promote thủ công/canary.

## Limitations and caching

- OpenNext chạy Next Node runtime trên Workers; không đặt `runtime = "edge"` trong routes. Node.js Middleware chưa được adapter hỗ trợ, nên middleware hiện tại chỉ dùng Web APIs.
- `_next/static` cache immutable; `/admin/*` no-store.
- Không có R2 incremental cache nên cache ISR không bền tuyệt đối giữa isolate/deploy. Backend public cache ngắn vẫn giảm tải. Chỉ thêm `NEXT_INC_CACHE_R2_BUCKET` sau phê duyệt tài nguyên và test invalidation.
- Build OpenNext và local Worker preview đã pass ngày 2026-10-10. Windows được adapter cảnh báo không tối ưu; CI Linux vẫn là quality gate chính.
- Sau build/upload, kiểm tra kích thước compressed Worker do Wrangler báo so với giới hạn plan.

## Rollback

Workers & Pages → Worker → Deployments/Versions → chuyển traffic về version đã xác minh. Khôi phục biến môi trường tương ứng nếu release thay đổi contract. Không rollback database bằng DROP/downgrade.
