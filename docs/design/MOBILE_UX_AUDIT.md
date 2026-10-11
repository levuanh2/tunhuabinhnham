# Mobile UX Audit

Baseline `2715b8f` audited at 360/390 (Chromium emulation) with the fixture API. Evidence: `screenshots/before/*-360.jpg`, `*-390.jpg`. Each row shows its status after the redesign.

| # | Defect at baseline | Fix | Status |
|---|---|---|---|
| M1 | Menu button had no handler, so no navigation on phones | `MobileNav` drawer (native modal dialog): close button, Escape, backdrop, scroll lock, focus containment and return | Fixed |
| M2 | No search entry point in the mobile header | Search button opens the drawer with the search field focused (`enterkeyhint=search`) | Fixed |
| M3 | Brand wrapped to 2 lines, "Nhắn tin" button wrapped | Brand truncates in one line (20/22px). The CTA moves into the drawer below 1024px | Fixed |
| M4 | Product card title squeezed beside price, SKU split | Stacked layout, 2-line clamp, `truncate` SKU | Fixed |
| M5 | 5 stacked filter controls before the first product | Search plus a "Lọc" button with an active-count badge that opens a bottom sheet (sort, price from/to, apply) | Fixed |
| M6 | Gallery rendered all images stacked, very long scroll | Scroll-snap swipe track, "n/total" counter, thumbnail strip | Fixed |
| M7 | Messenger CTA scrolls away. No persistent conversion path | Sticky bottom bar (price plus CTA) after the inline CTA leaves the viewport, safe-area padded, space reserved, only for an allowlisted URL | Fixed |
| M8 | Article headings, lists and quotes unstyled. Long URLs and tables could overflow | `.prose` rules, `overflow-wrap:anywhere`, tables and `pre` scroll in their own box | Fixed |
| M9 | Footer links about 24px tall | 44px rows on phones | Fixed |
| M10 | Admin nav: 3-column link grid above content (about 40% of the first screen) | Top bar plus drawer | Fixed |
| M11 | Admin tables `min-w-[700px]` scroll sideways | Card list on phones (products), list layout (categories) | Fixed |
| M12 | Admin product file input unstyled and small | Pill picker (≥36px, full-width layout on phones), previews constrained to the card | Fixed |
| M13 | No image reordering in the editor | ← → buttons (touch-friendly, no drag needed) | Fixed |
| M14 | Inputs 16px only by inheritance | `.field { font-size: 1rem }` set explicitly (prevents iOS focus zoom) | Fixed |
| M15 | `min-h-screen` (100vh) in admin and login | `min-h-dvh` / `h-dvh` | Fixed |
| M16 | No `viewport-fit=cover` or safe-area handling | `viewport` export plus `env(safe-area-inset-*)` on body, header, sheets, sticky bar, footer, admin | Fixed |
| M17 | Very narrow 320px 2-col grid | 1 column below 340px | Fixed |
| M18 | 768px: desktop nav wrapped (found in after-QA) | Desktop nav from 1024px, drawer below | Fixed |
| M19 | 768px: inline filters cramped (found in after-QA) | Search full row, filters row below at md; single row from lg | Fixed |

## Remaining / not addressed

- **Post editor is an HTML `<textarea>`**, not a rich-text editor (Tiptap is installed but was never wired). It is usable on phones, but a mobile rich-text toolbar does not exist yet. Building one is a feature, not a redesign, and was left out.
- The banner has one image field. A mobile-specific crop would need a schema change, which is out of scope. The hero uses `object-cover` at 4:3 on phones, so subjects should be centred in banner photos (documented for content editors).
- Admin product list shows the API's first page (unchanged behaviour). Pagination UI depends on the backend contract.
- Delete/hide confirmations use `window.confirm` (unchanged). This is functional on mobile but not styled.
