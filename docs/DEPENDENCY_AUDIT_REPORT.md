# Dependency audit report — Gate B.1

Ngày kiểm tra trực tiếp: 2026-10-11.

## Kết quả

| Phạm vi | Kết quả |
|---|---|
| Backend `pip-audit` trên `requirements.lock` | PASS — không có vulnerability đã biết |
| Frontend production `npm audit --omit=dev` | BLOCKED — 1 High, 1 Moderate |
| Toàn bộ npm dependency tree | BLOCKED — 6 High, 1 Moderate, không còn Critical |

Phiên bản thực tế từ lockfile: Next.js `15.5.27`, React/React DOM `19.3.0`, OpenNext Cloudflare `1.20.9`, OpenNext AWS `4.1.8`, Vitest `5.0.3`, PostCSS root `8.5.29`; riêng Next.js chứa PostCSS `8.4.31`.

## Production advisory còn tồn tại

Đường phụ thuộc là `next@15.5.27 -> postcss@8.4.31`. Bốn advisory được audit trả về:

- [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) — XSS khi stringify CSS.
- [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q) — đọc file qua `sourceMappingURL`.
- [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) — incomplete fix của file-read issue.
- [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) — path traversal qua source map.

Next.js `15.5.27` là bản 15 mới nhất tại thời điểm kiểm tra nhưng vẫn pin PostCSS `8.4.31`. `npm audit` chỉ đề xuất Next `16.4.0`, là major upgrade. Các thử nghiệm scoped override ở root, workspace và theo `next@15.5.27` đều không thay dependency lồng; chúng đã được gỡ để lockfile không tạo cảm giác đã vá.

Khả năng khai thác runtime hiện thấp: PostCSS chỉ chạy trong build trên CSS thuộc source repository; nội dung CMS không được đưa vào PostCSS, và backend loại `style` tag/attribute bằng allowlist Bleach. Rủi ro build/CI vẫn tồn tại nếu người tấn công có thể đưa CSS/source map độc hại vào source hoặc dependency. Đây là kiểm soát giảm thiểu, không phải bản vá.

Không dùng `npm audit fix --force` và không nâng Next 16 trên code chính. Repository chưa có baseline commit nên chưa thể tạo nhánh thử nghiệm có diff/rollback đáng tin cậy. Sau khi owner duyệt initial commit, tạo nhánh riêng để thử Next `16.4.x`, OpenNext, middleware, SSR, image và Worker build. OpenNext `1.20.9` khai báo peer hỗ trợ Next `>=16.3.8`, nhưng vẫn phải chạy regression đầy đủ.

## Development advisory

Chuỗi `eslint-config-next -> @next/eslint-plugin-next -> fast-glob -> micromatch -> braces@3.0.3` tạo 5 mục High quy dẫn về [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). `braces` chưa có release mới hơn `3.0.3`; đường này chỉ chạy trong lint trên tên file do repository kiểm soát. Hạ `eslint-config-next` xuống 14 không phải bản sửa phù hợp cho Next 15.

Vitest đã được nâng từ `3.2.7` lên `5.0.3`, loại 2 Critical và advisory phụ thuộc liên quan. Node local `22.18` đáp ứng engine của Vitest 5.

## Quyết định gate

Dependency security chưa PASS. Cần một trong hai approval trước Gate C production: (1) chấp nhận rủi ro có thời hạn kèm giới hạn build input và lịch nâng Next 16; hoặc (2) duyệt initial commit rồi thử/nâng Next 16 trên branch riêng. Không có High nào bị giấu hoặc tự động waive.
