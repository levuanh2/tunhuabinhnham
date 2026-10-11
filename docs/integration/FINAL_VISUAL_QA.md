# Final Visual QA: integrated build

- Commit inspected: `integration/warm-editorial-v2` @ **`2ad72ac`**, served from `E:\Tunhuabinhnham-integration` by `next start -p 3100` (production build), and separately as a Cloudflare Worker via `wrangler dev` on :8788 (workerd).
- Data: the local read-only fixture API plus fake Supabase Auth (`apps/web/e2e/fixtures/mock-api.mjs`, 127.0.0.1:8100). Product images are generated SVG drawings, **not real photography**. Real Supabase content and auth were not used.
- Engines: Playwright 1.64 Chromium (desktop plus phone emulation) and WebKit (`iPhone 13` profile). **No real devices.**

## Evidence (`docs/integration/screenshots/`)

| Folder | Pages | Viewports | Count |
|---|---|---|---|
| `public/` | home, product listing, product detail, news, article | 320, 360, 375, 390, 412, 430, 768, 1024, 1440 | 45 |
| `public-extra/` | contact, about, admin login, empty search | 360, 390, 768, 1024, 1440 | 20 |
| `admin/` (fake auth) | dashboard, product list, **product editor**, new product, categories, posts, banners, **settings (logo/favicon media uploader)** | 360, 390, 768, 1024, 1440 | 40 |
| `states/` | mobile menu, search focus, filter sheet, sticky Messenger CTA, admin drawer, login validation, wrong password (now Vietnamese), editor validation, editor category retention, write-failure toast | 390×844, Chromium + WebKit | 20 |

Each folder has a `report.json` with the per-screen horizontal-overflow and H1 check. `vitals.json` holds lab vitals. `pixel-diff-vs-design.json` holds the comparison below.

## Results

- **Overflow:** 0 / 105 screens overflow horizontally. Every screen has exactly one `<h1>`.
- **Design preservation:** all 105 integration screenshots were pixel-compared against the approved design set (`docs/design/screenshots/after`, branch `design/warm-editorial-v2`). Every pair has identical dimensions and **0.000% changed pixels** (luminance delta > 40). The Gate B.2 merge changed nothing visible.
- **Palette, typography, spacing, cards, buttons, forms, drawers, sticky CTA:** unchanged from the approved implementation (consequence of the pixel identity). Vietnamese rendering was verified by test 11: Newsreader and Be Vietnam Pro faces are loaded for "Tủ Nhựa Bình Nhâm", "Nguyễn", "cầu", "về", "Chất lượng", "Tủ nhựa gia đình", and glyph pixels differ from Georgia and Arial (no fallback).
- **Defect found and fixed during integration:** a wrong admin password showed Supabase's English "Invalid login credentials". It now shows `Email hoặc mật khẩu không đúng.` inline (`state-login-wrong-password*.jpg`), covered by test 13.

## Lab Web Vitals (`vitals.json`, final commit)

Chromium 390×844 at DPR 3, 150 ms RTT / 1.6 Mbps, CPU 4×, localhost production build: LCP 900–1152 ms, CLS ≤ 0.001, INP (one tap) 48–120 ms, about 322–353 kB transferred. These are **lab only** (SVG fixture images, no field data). Lighthouse was not run: npm registry access is unavailable in this sandbox.

## Not visually verified

- Real Supabase admin session, real uploads to Storage, real CMS content and banners (none exist yet), and the real store name (the database value is "Tủ Hòa Bình Nhâm"; the fixture uses the correct name).
- Real iOS/Android devices, VoiceOver/TalkBack, and an automated axe scan (not installed; adding it would change Codex-owned `package.json`).
