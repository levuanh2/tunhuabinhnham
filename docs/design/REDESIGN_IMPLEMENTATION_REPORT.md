# Redesign Implementation Report

Branch `design/warm-editorial-v2` in worktree `E:\Tunhuabinhnham-design`, base `2715b8f`. Frontend only: no backend, migration, dependency, Next/OpenNext config or middleware changes.

## Public site

| Screen | Change |
|---|---|
| Global | Semantic tokens (`@theme`), component classes in `@layer components`, font variables moved to `<html>` (fixes Vietnamese diacritics in the display face), `viewport` export (`viewport-fit=cover`, theme colour), safe-area padding, skip link. |
| Header | Compact sticky bar: brand from CMS (`store_name`, `logo_url`), centred nav with `aria-current`, a single "Nhắn tin" CTA (≥1024px). Below 1024px: **search** and **menu** buttons opening a native-dialog drawer with a search field, links and a Messenger CTA. Escape, backdrop and close button all close it. Background scroll is locked and focus is contained and returned. |
| Homepage | Catalogue-cover hero: CMS banner photo (4:3 on mobile, 5:4 on desktop) beside the headline. Falls back to a 3-product photo collage, then to an honest placeholder. Real CTA label from the banner when it points elsewhere. "Mua theo nhu cầu" category strip (image when `image_url` exists, horizontal snap scroll on phones). "Sản phẩm nổi bật" (`is_featured`), "Hàng mới về", brand intro using `about_text`, latest news with covers, Messenger CTA band. |
| Product listing | Category tabs (keep other filters), search with icon, price **from/to** (adds the existing `max_price` param), sort. Phones: search plus a "Lọc" button that opens a bottom sheet (the same form fields; the sheet renders inline ≥768px). Result count with `aria-live`, "Xoá bộ lọc", empty state with a recovery action, round pagination with `aria-current`. Grid: 1 col <340px, 2 phone, 3 tablet, 4 desktop. |
| Product card | 4:5 image well, stacked title (2-line clamp), price, SKU. Whole card clickable through one link (single tab stop). "Tạm hết hàng" badge. |
| Product detail | Breadcrumb, swipeable scroll-snap gallery with thumbnails and a "n/total" counter, title, SKU, price plus availability badge, prominent "Nhắn tin để mua" with guidance, compact copy buttons (with an error toast if the clipboard is blocked), specs `dl` only when attributes exist (nothing invented), description, "Sản phẩm cùng loại". **Mobile sticky Messenger bar** appears after the inline CTA scrolls away. It only renders for an allowlisted Messenger/Facebook URL and has safe-area padding plus reserved bottom space. |
| News | Lead story large, then a 3-column grid. Readable article: back link, excerpt, `<time>`, 16:9 cover, 44rem measure. `.prose` styles replace the missing typography plugin. Tables and code scroll in place. |
| About / Contact | Use CMS settings. Contact uses validated Messenger/Facebook links and `tel:`. |
| Footer | Charcoal (`ink`) instead of navy. Store name, hotline, address and Fanpage from settings. 44px touch rows on phones. |

## Admin CMS

| Screen | Change |
|---|---|
| Shell | Light sidebar with full brand, active state, "Xem website", logout with a busy state and an error toast. Phones: top bar plus a **drawer** (same `Sheet`, inline ≥768px). `min-h-dvh`, safe-area. |
| Login | Centred panel on cream, inline `role=alert` for auth errors, `aria-invalid` fields. The Supabase sign-in call is unchanged. |
| Dashboard | 5 metrics in a hairline grid (2 columns on phones), linking to their lists, skeletons while loading, retry on error. Shows only the API's numbers. |
| Products list | Server-side search (existing `?search=` API param, deferred input) plus a status filter (published / draft / hidden). Card list on phones, table on ≥768px, thumbnails, formatted price, status badges with dot and text. |
| Product editor | Two-column layout (content | sticky "Hiển thị" panel with publish, stock, visibility, save). Upload button with focus ring, `n/20` counter, empty state, **reorder images (← →)**, primary badge, alt text per image. **Bug fix:** the category select remounts when options load, so the saved category is shown and preserved. |
| Categories | Panel form plus a responsive list (no table) with an accessible delete label. |
| Posts / Banners / Settings | Restyled panels, badges, current-item highlight, `QueryError` retry. Settings shows a hint on "Tên cửa hàng" with the correct brand. Media upload uses outlined pickers, previews, danger remove. **No logic changes** to upload, replace, remove or cleanup. |

## Preserved behaviour (not rewritten)

`publicApi`, `adminFetch` (including `/api/revalidate` cache invalidation), Supabase browser and SSR clients, middleware, the logout route sequence, react-hook-form/zod schemas, media validation and cleanup, Messenger host allowlist (extracted to `lib/messenger.ts` with unit tests, same rules), and JSON-LD.

## New files

`components/sheet.tsx`, `site-nav.tsx`, `product-filters.tsx`, `product-gallery.tsx`, `sticky-contact.tsx`, `post-card.tsx`, `section-heading.tsx`, `lib/messenger.ts` (+ test), `lib/date.ts`, `e2e/responsive.spec.ts`, `e2e/fixtures/mock-api.mjs`, `e2e/visual-qa/*.mjs`, `docs/design/*`.

## Verification (final run, 2026-10-11)

| Check | Result |
|---|---|
| `npm --workspace apps/web run typecheck` | pass |
| `npm --workspace apps/web run lint` (max-warnings 0) | pass |
| `npm --workspace apps/web test` (Vitest) | 2 files, 4 tests passed |
| `npm --workspace apps/web run build` | pass |
| `npm --workspace apps/web run build:cloudflare` (OpenNext) | pass: `.open-next/worker.js` generated |
| Playwright `e2e/` against the production build on :3100 with fixtures (`E2E_MOCK_API=1`) | **23 passed, 5 skipped** (4 = real-Supabase staging CMS tests, which need credentials and write approval; 1 = phone-only test on the desktop project). Projects: Desktop Chrome (Chromium) and iPhone 13 (WebKit). |
| Python API tests | not run: no backend change |

The production builds were made with `.env.local` pointing at the local fixture API and fake auth. They are local verification artefacts only and must not be deployed. Codex's own builds use their environment.
