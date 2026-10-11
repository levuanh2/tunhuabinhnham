# Responsive Design Spec

Mobile-first: base styles target phones and widen at Tailwind breakpoints.

| Breakpoint | Width | What changes |
|---|---|---|
| base | 320–339 | Product grids 1 column. Brand 20px |
| `min-[340px]` | ≥340 | Product grids 2 columns |
| `min-[380px]` | ≥380 | Brand 22px |
| `sm` | ≥640 | Category tiles 40% width; admin filters side by side |
| `md` | ≥768 | Grids 3 columns; filters inline (2 rows); admin sidebar inline instead of drawer; admin table instead of cards; footer 3 columns |
| `lg` | ≥1024 | Desktop header nav plus CTA; 12-column hero and product detail (sticky info column); grids 4 columns; filters one row |
| shell | max 1240 | Gutters: 16px under 768, 32px from 768 |

## Target viewports (all screenshotted, 0 overflow)

320×568, 360×800, 375×812, 390×844, 412×915, 430×932, 768×1024, 1024×768, 1440×900.

## Rules

- **Touch targets:** primary actions ≥44px (`.button`, icon buttons `size-11`, nav and drawer rows `min-h-11`/`min-h-13`, footer rows). Dense admin secondary actions (`.button.sm` 36px, image reorder 36px) sit in rows with ≥4px spacing.
- **Inputs:** 16px text, `type=search` with `enterkeyhint`, `inputmode=numeric` for prices.
- **Viewport:** `width=device-width, initial-scale=1, viewport-fit=cover`. Zoom is never disabled.
- **Height:** `dvh` for full-height admin and login and the side sheets. Bottom sheet `max-h-[85dvh]`.
- **Safe areas:** body inline insets. The header, admin bar and sheet headers use the top inset. The bottom sheet, sticky CTA, drawer footer, page footer and admin main use the bottom inset.
- **Images:** `next/image` with `sizes` for every layout, fixed aspect boxes (no CLS), `priority` only for above-the-fold (hero or first gallery image), lazy otherwise.
- **Sheets:** one `Sheet` component on native `<dialog>.showModal()`. It provides Escape, an inert background, focus containment and focus return (keyboard), plus scroll lock and a backdrop click. `inlineFromMd` renders the same fields inline on wider screens, so inputs are never duplicated. If the viewport crosses 768px while open, the sheet closes.
- **Sticky CTA:** product detail only (no text inputs on that page, so the on-screen keyboard cannot cover it). Hidden (`inert`, `aria-hidden`) until the inline CTA scrolls above the viewport. The page reserves `pb-32` on phones.
- **No hover dependency:** every hover affordance has a tap or focus equivalent. Cards are fully clickable.
- **Motion:** only transform and colour transitions. All are disabled under reduced motion.
- **Status:** never colour alone. Badges carry text plus a dot. Out-of-stock adds a text badge on the image.
