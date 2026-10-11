# DNS, HTTPS và CORS

## DNS dự kiến

- Apex `example.com`: custom domain của Cloudflare Worker.
- `www.example.com`: redirect 301 tới apex bằng Cloudflare Redirect Rule; không phục vụ app ở cả hai origin nếu không cần.
- `api.example.com`: CNAME/target theo hướng dẫn Custom Domain của Render, proxied qua Cloudflare chỉ sau khi Render xác minh certificate/domain.

Không đổi DNS trước approval. Dùng TTL thấp cho cutover, xác minh certificate ở cả Cloudflare và Render, rồi ép HTTPS. Không cache `/api/v1/admin/*`, `/api/v1/auth/*`, response có Authorization hoặc Set-Cookie tại Cloudflare.

Sau khi custom domain API hoạt động, tạo Cloudflare rate-limit rules tối thiểu cho `/api/v1/admin/*` và `/api/v1/contact-clicks`; loại trừ health checks. Backend còn có guard 120 request/phút theo admin ID cho cấu hình một worker, nhưng rule edge mới bảo vệ được trước khi request tới Render. Không bật challenge trên OPTIONS preflight.

## CORS matrix

Development:

```dotenv
CORS_ORIGINS=http://localhost:3000
```

Production canonical apex:

```dotenv
CORS_ORIGINS=https://example.com
FRONTEND_URL=https://example.com
```

Nếu `www` chỉ redirect thì không cần allowlist. Nếu preview được duyệt, thêm từng origin chính xác, phân tách bằng dấu phẩy; không dùng wildcard/regex reflection. API cho credentials, methods GET/POST/PATCH/DELETE/OPTIONS và headers Authorization/Content-Type/X-Request-ID.

CORS không thay thế authentication. Bearer token vẫn bắt buộc cho admin. Với mô hình token trong Authorization hiện tại, CSRF cookie không phải cơ chế auth API; nếu sau này đổi sang HttpOnly cookie thì thêm CSRF token, Secure và SameSite phù hợp.

Smoke tests:

```sh
curl -i -X OPTIONS https://api.example.com/api/v1/admin/products \
  -H "Origin: https://example.com" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Authorization"

curl -i https://api.example.com/api/v1/admin/products \
  -H "Origin: https://attacker.invalid"
```

Lệnh hai phải không có `Access-Control-Allow-Origin`; endpoint vẫn trả 401 nếu thiếu token.
