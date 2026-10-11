# Design System: Warm Editorial Minimalism

Source of truth: `apps/web/src/app/globals.css` (`@theme` tokens plus `@layer components`). Tailwind 4 turns every `--color-*` token into utilities (`bg-bg`, `text-ink-soft`, `border-line`, …), so components never hardcode hex values.

## Principles

1. **Product photography is the hero.** Pages are quiet so images carry the colour. The page itself has no gradients, patterns or decorative shapes.
2. **One accent, used for action.** Brown `primary` marks what you can do (CTA, active nav, focus). Green and red are reserved for success and error/destructive states only.
3. **Editorial headings, functional body.** The serif carries the voice in headings. Everything you read or operate uses the sans.
4. **One primary action per context.** For example: "Nhắn tin để mua" on product detail, "Lưu sản phẩm" in the editor, "Thêm sản phẩm" in lists.
5. **Structure over decoration.** Hairline dividers and whitespace instead of heavy cards. Panels appear only in the admin, where grouping aids data entry.

## Colour tokens

| Token | Hex | Use |
|---|---|---|
| `bg` | `#FAF7F2` | Page background (warm cream) |
| `surface` | `#FFFFFF` | Panels, inputs, category strip |
| `muted` | `#F3EEE7` | Image wells, brand-intro band, skeletons |
| `line` | `#E8DFD2` | Dividers, panel borders |
| `line-strong` | `#D6C9B8` | Dashed empty states, link underline |
| `control` | `#968A7D` | **Added.** Input and outlined-button boundaries (3.37:1 on white, WCAG 1.4.11) |
| `sand` | `#A78B73` | Decorative only: list markers, arrow icons, blockquote rule (2.98:1, never text) |
| `primary` | `#67503F` | CTA fill, active states, focus ring, links |
| `primary-hover` | `#4F3C2E` | Hover / pressed |
| `primary-soft` | `#EFE6DC` | Active nav background, text on the primary band |
| `ink` | `#292724` | Headings, body, footer background |
| `ink-soft` | `#706B64` | Secondary text, meta |
| `success` / `success-soft` | `#2F6B3F` / `#E6F0E7` | "Còn hàng", "Đã xuất bản" |
| `danger` / `danger-soft` | `#B42318` / `#FBEAE8` | Errors, delete/hide |

Approved starting values are kept unchanged. Two values were added for accessibility: `control` and the placeholder colour `#77716A`.

### Measured contrast (WCAG 2.x relative luminance)

| Pair | Ratio | Result |
|---|---|---|
| ink on bg | 13.94:1 | AAA |
| ink-soft on bg / surface / muted | 4.94 / 5.28 / 4.58:1 | AA |
| primary on bg | 7.03:1 | AAA |
| white on primary / primary-hover | 7.51 / 10.41:1 | AAA |
| primary-soft on primary (CTA band text) | 6.09:1 | AA |
| success on success-soft | 5.46:1 | AA |
| danger on danger-soft / surface | 5.65 / 6.57:1 | AA |
| footer text / meta on ink | 10.02 / 5.84:1 | AA |
| placeholder `#77716A` on white | 4.82:1 | AA |
| control border on white | 3.37:1 | 1.4.11 non-text, pass |

## Typography

| Family | Role | Why |
|---|---|---|
| **Newsreader** (Google, `latin` + `vietnamese`) | Display: H1–H3, brand wordmark, prices are *not* set in it | A low-contrast, warm text serif. It reads editorial without the fashion-luxury feel of Didone faces. It was already loaded, so there is no new font cost. |
| **Be Vietnam Pro** (400/500/600/700, `latin` + `vietnamese`) | Body, UI, admin, prices | Designed for Vietnamese. Diacritics stack cleanly at small sizes. |

Both are self-hosted by `next/font` with `display: swap`.

**Implementation note (bug fixed during QA):** next/font variables must sit on `<html>`, not `<body>`. `@theme` tokens such as `--font-display: var(--font-newsreader)` are resolved at `:root`. With the variables on `<body>`, the display font silently fell back to Georgia, which lacks precomposed Vietnamese double-diacritic glyphs, so marks rendered detached (the grave accent floated after "â"). The variables are now named `--font-newsreader` and `--font-be-vietnam`, so they cannot collide with Tailwind's default `--font-serif`.

| Class | Size | Line-height | Tracking |
|---|---|---|---|
| `.h-hero` | clamp(2.5rem, 6vw, 4.75rem) | 1.04 | −0.03em |
| `.h-page` | clamp(2.25rem, 4.5vw, 3.5rem) | 1.08 | −0.02em |
| `.h-section` | clamp(1.75rem, 3vw, 2.5rem) | 1.12 | −0.02em |
| `.lede` | 1.125rem | 1.7 | 0 (max 38rem) |
| body | 1rem | 1.6 | 0 |
| `.prose` | 1.0625rem | 1.8 (serif-free body; measure ≤ 44rem) | 0 |
| admin H1 | 1.25rem / 1.5rem (md) sans 600 | tight | −0.01em |
| admin table | 0.875rem; header 0.75rem 600 | — | — |

The design uses no all-caps labels and no eyebrow text. `text-wrap: balance` is set on display headings.

## Components (`@layer components`)

They live in a cascade layer so Tailwind utilities (`hidden`, `md:inline-flex`, …) can always override them.

- `.button` (primary pill, min 44px), `.secondary` (outlined), `.ghost` (text), `.danger`, `.sm` (36px, dense admin rows only)
- `.field` (16px text, which stops iOS zoom), `.label`, `.hint`, `.error`, `[aria-invalid]` state, a custom select chevron
- `.panel` (admin grouping), `.badge` (`.success`, `.danger`, always paired with text and a dot, never colour alone), `.alert`
- `.table` (admin), `.prose` (articles: tables and code scroll in their own box, long URLs wrap)
- React: `Sheet` (native modal `<dialog>`), `ProductCard`, `PostCard`, `SectionHeading`, `ProductGallery`, `ProductFilters`, `StickyContact`, `AdminPageHeader`, `QueryError`

## Shape, depth and motion

- Radius follows hierarchy: images `rounded-xl`/`2xl`, panels `xl`, inputs `lg`, buttons and badges pill.
- Shadows appear only on floating layers (sheet, sticky bar). Cards and panels have none.
- Motion: image hover scale 1.025, sticky-CTA slide, colour transitions of 150ms. Everything collapses under `prefers-reduced-motion`, and the gallery's programmatic scroll switches to `auto`.

## Focus

The focus ring is 2px `primary` with a 3px offset (7:1 on cream). Inputs use a 3px soft primary ring. The custom file-picker labels show the ring through `has-[:focus-visible]`.
