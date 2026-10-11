# UI/UX Audit V2: baseline before the redesign

- Base commit: `2715b8f` (`main`, "chore: establish secure project baseline")
- Audited on: 2026-10-11, from Claude's isolated worktree `E:\Tunhuabinhnham-design`, branch `design/warm-editorial-v2`
- Renderer: Playwright 1.64 Chromium (headless) on Claude's own `next dev` instance at `http://localhost:3100`. **Not** the Codex instance on :3000.
- Data: the real local API (`127.0.0.1:8000`, Codex's process, read-only GETs only) returned **0 products, 0 categories, 0 banners and 0 posts**, so layouts were audited against the read-only QA fixture API (`apps/web/e2e/fixtures/mock-api.mjs`, 8 products, 5 categories, 3 posts, 1 banner). Fixture product images are drawings generated for QA, not real product photos.
- Evidence: `docs/design/screenshots/before/*.jpg` (9 pages × 360/390/768/1024/1440) and `before/report.json` (overflow + H1 report).

## Data finding (needs a CMS action, not a code change)

`GET /api/v1/site-settings` returns `store_name: "Tủ Hòa Bình Nhâm"`. The correct brand is **Tủ Nhựa Bình Nhâm**. The header, footer, "Về …" section and the About page read this value from Supabase `site_settings`. As the brief requires, the redesign does **not** override it with a hardcoded value.
**Action for the owner:** Admin, then Cài đặt, then Tên cửa hàng: change it to `Tủ Nhựa Bình Nhâm` and save. Claude made no Supabase writes. The settings field now shows a hint with the correct example.

## Findings

Severity: **H** = broken or blocks a task, **M** = clear quality or accessibility defect, **L** = polish.

| # | Area | Finding | Sev |
|---|------|---------|-----|
| 1 | Brand / colour | Cobalt `#1648d8` + lime `#d6f23d` + navy footer: a SaaS palette that conflicts with the approved Warm Editorial direction. Colours were hardcoded in about 30 places (`text-[#1648d8]`, `bg-slate-*`), with no semantic tokens. | H |
| 2 | Mobile header | The menu button (`<button className="md:hidden">`) had **no handler**, so phones had no navigation at all. At 360–390px the brand name wrapped onto 2 lines and squeezed the "Nhắn tin" button into 2 lines. | H |
| 3 | Article body | `.prose` is used but `@tailwindcss/typography` is not installed. Headings, lists and blockquotes rendered as plain paragraphs (`before/article-1440.jpg`). | H |
| 4 | Product card (mobile) | Title and price sat side by side. At 390px titles broke every 1–2 words and SKUs split mid-token ("TN-5T-/01"). | H |
| 5 | Hero | Huge solid cobalt block with an abstract blob mask (`rounded-[18%_42%_16%_38%]`) that crops the banner photo. This is the "generic hero" the brief rules out. | M |
| 6 | Product listing | Only "Giá từ" (no max). Inputs were hard to tap on phones (5 stacked controls before the first product). No "clear filters". No category tabs: categories only appeared in a select. | M |
| 7 | Product detail | All images rendered as a stacked grid (very long scroll on mobile). No swipe and no indicator. Messenger CTA shared visual weight with 2 equal "copy" buttons. Availability was plain text. | M |
| 8 | Homepage | No featured-products section and no category imagery. News items had no cover image. The CTA section was text-only. | M |
| 9 | Footer | No hotline, address or Facebook from settings. Navy colour off-brand. | M |
| 10 | Focus | Focus ring was 3px lime: low contrast on white (about 1.2:1). | M |
| 11 | Admin shell | Navy sidebar became a 3-column grid of links above the content on mobile and took about 40% of the first screen. No "view site" link. Logout failure was silent. | M |
| 12 | Admin tables | `min-w-[700px]` tables scroll horizontally on phones. The price column showed the raw number (`1250000`). Status was plain text. | M |
| 13 | Admin product editor | Native unstyled `<input type=file>`. No image reordering. **Bug:** the category `<select>` registers before its options load, so an existing product showed "Chưa phân loại" and saving would clear the category. | H |
| 14 | Admin login | Errors only in a toast. No inline alert. No guidance on configuration errors. | L |
| 15 | Typography | Two good families were already loaded (Be Vietnam Pro + Newsreader, both with the Vietnamese subset), but the scale was ad hoc (`text-5xl`, `text-6xl` per page) and there was no admin scale. | L |
| 16 | Dates | `toLocaleDateString` without a timezone could render a different day on server and client. | L |
| 17 | Overflow | `before/report.json`: 0 horizontal-overflow pages at the 5 audited widths. The defects are clipping and wrapping, not page-level overflow. | — |

## What worked and was kept

- The data flow (server components with `publicApi`, React Query in admin), Messenger host allowlisting, JSON-LD and the logout sequence.
- Both font families. They were re-wired (see the design system doc) rather than replaced.
