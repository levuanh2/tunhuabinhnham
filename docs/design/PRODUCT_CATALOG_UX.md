# Product form and product categories (Loại sản phẩm): UX report

Date: 2026-10-13. Branch `feat/product-form-ux` (from `integration/warm-editorial-v2` @ `74522b8`):
- `a05a3f5` feat(api)
- `1f8de07` feat(web)
- review fixes (see "Codex review")

Status: **not deployed** and not merged.

Verdict: **READY_FOR_REVIEW**. The owner decisions below are open, and all four Codex warnings are resolved; Codex re-review was requested.

## Audit

| Area | Finding |
|---|---|
| Product form | `src/features/admin/product-form.tsx`. The admin had to type `Slug` and `SKU` by hand. The slug was not generated, and a duplicate value showed as the raw API text "Slug already exists" |
| API contract | `slug`: lowercase ASCII words and hyphens, max 260, unique. `sku`: **required**, `[A-Za-z0-9._-]`, max 80, unique. Both are DB unique constraints; a conflict returns 409 with a fixed message (`core/conflicts.py`) |
| Publishing | `published_at` is set once, on the first publish, and never cleared (`services/catalog.py`) |
| Old URLs | `/san-pham/[slug]` returns `notFound()` for an unknown slug. **There is no redirect table and no 301 from an old slug** |
| Categories | One level: `categories` already has `name`, `slug` (unique, kept by soft delete), `description`, `image_url`, `is_visible` and `sort_order`; products have one `category_id` |
| Public filter | `/san-pham?category=<slug>` already had tabs, an empty state and pagination; the homepage already has a "Mua theo nhu cầu" category section |
| Category delete | Soft delete. Products kept their `category_id`, so a deleted category stayed attached to them (orphan link) |
| Cache | Every admin mutation goes through `adminFetch` → `POST /api/revalidate` → Next revalidation + Workers Cache tag purge (Gate C3.1) |
| Latent bug | If the cache refresh failed **after** a successful create, the form showed an error and stayed open. Pressing Save again would create the product a second time |

Production categories (public API, read-only): `do-dung` "Đồ dùng" and `qua-tang` "Quà tặng", both seed samples, with 0 public products. Nothing was changed.

## Approach: reuse what exists

- No new table, no migration, no DNS or hosting change, no production write.
- Category, the Category API, `product.category_id` and the Danh mục page are reused. The page is renamed **Loại sản phẩm** in the admin menu, dashboard and form.
- Technical field names (`slug`, `sku`, `publish_status`…) are unchanged in code and API.
- Backend changes (no schema change):
  1. `GET /admin/categories` adds `product_count` (non-deleted products per category). The public `GET /categories` is unchanged; a test asserts this.
  2. `DELETE /admin/categories/{id}` returns **409 "Category has products"** while non-deleted products use the category, so no product is left pointing at a deleted category.
  3. `PATCH /admin/products/{id}` returns **409 "Published product URL cannot change"** when the slug changes on a product that was ever published (`published_at` set). The product row is re-read under a row lock, so a form opened before someone else published cannot break the public URL.
  4. Create/update product with a deleted or unknown `category_id` returns **422 "Category not found"**. Assignment takes `FOR SHARE` on the category row and delete takes `FOR UPDATE`, so on PostgreSQL a concurrent assign and delete serialize: the product is either counted and the delete refused, or the assignment refused.
  5. Public `GET /products?category=<slug>` ignores hidden categories (`is_visible = false`), as it already ignored deleted ones.

## Product form: before → after

| Before | After |
|---|---|
| Slug (typed) | **Đường dẫn sản phẩm**, shown as a preview `/san-pham/tu-nhua-5-tang-mau-trang`, generated from the name (`đ`→`d`, accents, punctuation). **Chỉnh sửa đường dẫn** reveals an input; after a manual edit the name no longer overwrites it, and **Tạo lại từ tên** switches back |
| SKU (required) | **Mã sản phẩm (không bắt buộc)**: "Mã riêng để phân biệt và quản lý các mẫu tủ", example `TN-5T-001`. When left empty it is generated from the URL, e.g. `TN-TU-NHUA-5-TANG-MAU-TRANG`, because the API requires it |
| Giá (VNĐ) | **Giá bán (VNĐ)**: accepts `1.250.000`, `1 250 000` or `1250000`, with an inline error for anything else |
| Danh mục / "Chưa phân loại" | **Loại sản phẩm**, placeholder "Chọn loại tủ"; hidden categories are marked "(đang ẩn)"; a message is shown when none exist; **Quản lý loại sản phẩm** opens in a new tab so the unsaved form is not lost |
| Xuất bản: Bản nháp / Xuất bản | **Trạng thái đăng bán: Chưa đăng / Đăng bán** |
| Tình trạng | **Tình trạng hàng** |
| Hiển thị sản phẩm trên website | **Hiển thị trên website**, with the hint "Bỏ chọn để tạm ẩn sản phẩm mà không cần gỡ đăng" |
| Button "Lưu sản phẩm" | **Lưu bản nháp** (draft), **Đăng sản phẩm** (first publish) or **Lưu thay đổi** (already published), plus a live line saying whether customers can see the product |

### Uniqueness and concurrency

The database constraint is the final check. A generated URL or code that hits a 409 is retried as `-2`, `-3`… (up to 20 times). This also covers two admins saving the same name at the same moment: one save wins, the other gets `-2`, and the admin is told the URL that was used.

A URL or code the admin typed is not changed silently. The error is shown at the field ("Đường dẫn này đã có sản phẩm khác dùng…", "Mã sản phẩm này đã dùng cho sản phẩm khác"), and every other input is kept.

### Editing a product

- The URL never changes when the name changes.
- **A product that was ever published (`published_at` set, or currently published) keeps its URL: there is no edit button.** There is no 301 support, and a changed slug would break links customers saved or shared and pages Google indexed.
- A product that was never published can change its URL, with the warning "đổi đường dẫn sẽ đổi địa chỉ trang".

### Cache refresh failure

A save whose cache refresh fails is treated as saved: the admin sees "Trang web công khai sẽ tự cập nhật trong vòng 5 phút" and the form is never submitted twice.

## Loại sản phẩm page: before → after

| Before | After |
|---|---|
| "Danh mục": name + slug inputs, list, delete | "Loại sản phẩm": name with an automatic filter URL preview, optional short description, suggestion chips for missing types (Tủ quần áo, Tủ ngăn kéo, Tủ giày dép, Tủ nhựa trẻ em, Tủ đa năng, Kệ nhựa; suggestions only, nothing is hardcoded as data) |
| — | Duplicate name or slug is rejected inline (case-insensitive). A slug still reserved by a deleted category is retried as `-2` |
| — | Rename and description edit inline; **the slug is kept**, so shared filter links keep working |
| — | Reorder with up/down buttons (`sort_order`); the public tabs follow |
| — | Ẩn / Hiện (`is_visible`). A hidden type leaves the public filter and homepage; its products stay on sale |
| — | "N sản phẩm" per type |
| Delete with "Ẩn và xóa…?" confirm | A type with products cannot be deleted: a message says how many products to move first (no dialog, no request), and the API enforces the same with 409. An empty type asks for confirmation |

## Public website

- `/san-pham`: the first tab reads **Tất cả sản phẩm**; the nav is labelled "Loại sản phẩm"; tabs are at least 44 px tall.
- A type with no products shows "Chưa có sản phẩm nào trong “…”".
- A hidden or deleted type's link shows "Loại sản phẩm này hiện không còn hiển thị" instead of a mislabelled "Tất cả sản phẩm" list.
- The canonical URL stays `/san-pham`; the URL with `?category=` is shareable and survives a reload.
- The homepage keeps its existing "Mua theo nhu cầu" section (no duplicate section added).

## Screenshots

- **After**: `docs/design/screenshots/product-form-ux/`, 360/390/768/1024/1440 px.
  - Pages: `admin-new-filled`, `admin-new-slug-conflict`, `admin-edit-published`, `admin-categories`, `products-category`.
  - Fixture data, local workerd; 0 page errors.
- **Before** (Warm Editorial V2 baseline): `docs/design/screenshots/after/admin/admin-new-*.jpg`, `admin-categories-*.jpg`.

## Tests

| Suite | Result |
|---|---|
| TypeScript, ESLint | PASS |
| Vitest | 23/23 (new `slug.test.ts`: Vietnamese slugs, empty/invalid input, length limits, suffixes, product codes, VND prices) |
| OpenNext build (fixture env) | PASS |
| Playwright on local workerd + fixture API, Chromium desktop + iPhone 13, `--workers=1` | **54 passed, 0 failed, 28 skipped** (skipped = live-staging spec and desktop-only write tests on mobile) |
| New `e2e/catalog-admin.spec.ts` | see the list below |
| Backend pytest (`-m "not integration_supabase"`) | 74 passed. New tests cover product counts, the delete guard, deleted products not blocking delete, duplicate category slug, public contract unchanged, published slug kept (incl. a stale save after publishing), assignment to a deleted category refused, and hidden category filter. **2 pre-existing failures** in `test_logging.py` (see Risks) |
| ruff, mypy | PASS |

`e2e/catalog-admin.spec.ts` covers:
- auto URL and manual edit;
- empty and invalid name;
- invalid price;
- blank code + duplicate name → `-2`; retries to `-3` across mixed slug and code conflicts (4 create requests counted);
- failed `/api/revalidate` reported as saved, with exactly one create request;
- a stale form after another admin published keeps the URL;
- a category deleted in another tab is reported at the field;
- every category hidden → the public filter shows the empty state, and the API returns 0;
- category and price saved;
- draft vs publish;
- `/api/revalidate` 200 on save;
- typed URL or code conflict at the field, with input kept;
- published product keeps its URL and category on rename;
- hidden product absent from the public category list and 404;
- category create, duplicate, rename (slug kept), reorder, hide, delete blocked, delete, reserved slug;
- hidden category in the form;
- filter shareable, reload and touch size;
- admin category page requires a session.

## Codex review (`PRODUCT_UX_REVIEW.md`, CHANGES) and resolution

| # | Finding | Resolution |
|---|---|---|
| WARN-001 | Slug lock was UI-only; a stale form could change a URL published meanwhile | API refuses the slug change once `published_at` is set (row lock); the form restores the old URL with a field message. pytest + e2e P6 |
| WARN-002 | A product could be assigned to a category during or after its soft delete | `Category not found` 422 on assignment; `FOR SHARE`/`FOR UPDATE` pairing serializes assign vs delete on PostgreSQL. Sequential pytest + e2e C3. The test DB is single-connection SQLite, so a true two-session race is not reproducible in this suite |
| WARN-003 | Hidden category URL could still list products (API ignored `is_visible`; the page relied on a non-empty category list) | API filter skips hidden categories; the page treats any category missing from a successfully loaded list as unknown. pytest + e2e C3 (all hidden) |
| WARN-004 | No coverage for `-3`, mixed conflicts or a failed cache refresh | e2e P5 counts create requests for both cases |

## Decisions for the owner

1. **Production categories "Đồ dùng" and "Quà tặng"** are seed samples. Suggestion: in Admin → Loại sản phẩm, delete both (they have 0 public products) and add the six types with the suggestion buttons, or rename them if they are real. Nothing was changed on production.
2. **Changing the URL of a published product** is disabled until there is a redirect.
   - Proposal: a `product_slug_redirects(old_slug, product_id)` table (migration), written by the API when a slug changes, and a 301 in `/san-pham/[slug]` when the slug is unknown but present there.
   - Needs approval: it is a schema change.
3. **Hidden category, visible products**: products in a hidden type stay listed under "Tất cả sản phẩm". If hiding a type should also hide its products, that is a separate change.
4. **Deleted category slugs stay reserved** (soft delete + unique constraint). Re-creating a deleted type gets `-2`. A partial unique index (`where deleted_at is null`) would free them, but it needs a migration.

## Risks

- **Backend redaction fix not committed (pre-existing, outside this change)**:
  - `apps/api/tests/test_logging.py` has 2 tests (startup validation error redacted; uvicorn startup failure as redacted JSON) that fail on the committed code of this branch, of `integration/warm-editorial-v2` and of `deploy/c2-preview`.
  - They pass only in Codex's worktree `E:\Tunhuabinhnham-c3-api`, which has **uncommitted** changes to `core/config.py` and `core/logging.py`.
  - Render runs `b532ac4`, so production lacks those uncommitted startup-redaction fixes. Codex should commit them.
- Category reorder sends one PATCH (and one cache purge) per moved item; fine for a handful of types, but bursts can hit Free-tier purge rate limits (the 5-minute TTL is the backstop).
- A product added to a category between the page check and the delete request is caught by the API 409; the check itself has a tiny race between count and commit.
