# Mobile Visual QA Report

## What was actually tested

| Engine | How | Covers |
|---|---|---|
| Chromium (Playwright 1.64 headless) | Viewport, touch and `isMobile` emulation | "Chrome Android"-like layout, desktop Chrome, tablet |
| WebKit (Playwright 1.64, `iPhone 13` profile) | Device emulation | "Safari iOS"-like engine behaviour |
| Real iPhone / Android | **Not tested.** No device or remote browser was available. Results are emulation only. | — |

Server: Claude's production build on :3100 with the fixture API and fake auth (see `VISUAL_QA_REPORT.md`).

## Screenshots

- All 9 target viewports for home, products, detail, news and article: `screenshots/after/<page>-<width>.jpg`
- Admin at 360/390/768/1024/1440: `screenshots/after/admin/`
- States, Chromium and WebKit: `screenshots/states/` (mobile menu open, search focused, product filter sheet open, sticky Messenger CTA, admin drawer open, login validation, wrong password, editor validation, editor category, write-failure toast)

Overflow report: 0 of 130 after-screens overflow horizontally.

## Responsive regression tests (`apps/web/e2e/responsive.spec.ts`)

Run: `E2E_MOCK_API=1 E2E_BASE_URL=http://localhost:3100 npx playwright test` (from `apps/web`). Final run: **23 passed, 5 skipped, 0 failed** across Desktop Chrome and iPhone 13 (WebKit).

| # | Test | Desktop | iPhone 13 (WebKit) |
|---|---|---|---|
| 1 | No overflow on 6 public pages × 9 viewports | pass | pass |
| 2 | Mobile nav: modal sheet, scroll lock, Escape closes, focus returns, search focus | skip (phone only) | pass |
| 3 | Grid columns 1 / 2 / 4 at 320 / 390 / 1440 | pass | pass |
| 4 | Search plus sort (bottom sheet on phones) keep params | pass | pass |
| 5 | Gallery thumbnails, "2/3" counter | pass | pass |
| 6 | Messenger CTA opens an allowlisted URL; sticky bar becomes active | pass | pass |
| 7 | Article measure ≤ 44rem, no overflow | pass | pass |
| 8 | Admin drawer (phone) / sidebar (desktop) | pass | pass |
| 9 | Admin form validation next to the field, `aria-invalid` | pass | pass |
| 10 | Media controls present, category preserved, save button ≥44px | pass | pass |
| — | Existing `public.spec.ts` (2 tests) | pass | pass |
| — | `staging-cms.spec.ts` (real Supabase, 2 tests) | skip | skip (`BLOCKED_EXTERNAL_CONFIGURATION`) |

Defects found by these tests and fixed: WebKit does not focus buttons on tap (the test now uses keyboard activation, the real accessibility guarantee), and a label wrapping a `<select>` gave it the name "Sắp xếpMới nhất…" (now `htmlFor`). The staging spec was made layout-agnostic: it uses the product link instead of a table row, and opens the admin drawer before "Đăng xuất" on phones.

## Performance (lab only)

**Lighthouse: NOT RUN.** It could not be installed because npm registry access is blocked in this sandbox, so no Lighthouse scores are claimed.

Lab Web Vitals via `e2e/visual-qa/vitals.mjs`: Chromium, 390×844 at DPR 3, emulated 150ms RTT / 1.6 Mbps down, CPU throttled 4×, production build on localhost.

| Page | LCP | CLS | INP (one tap) | Transfer |
|---|---|---|---|---|
| `/` | 976 ms | 0 | 112 ms (open menu) | 353 kB |
| `/san-pham` | 760 ms | 0.001 | 104 ms (open filter sheet) | 322 kB |
| `/san-pham/tu-5-tang` | 788 ms | 0 | 40 ms (thumbnail) | 321 kB |
| `/tin-tuc/chon-tu-phong-ngu` | 780 ms | 0 | n/a | 335 kB |

Caveats: fixture images are inline SVG data URIs (no image download), so real-photo LCP will be higher. Fonts are self-hosted. These are **lab numbers, not field data** (no CrUX/RUM available). Targets (LCP ≤ 2.5s, CLS ≤ 0.1, INP ≤ 200ms) are met in this lab setup only. Re-measure on staging with real images and Lighthouse.

First-load JS (from `next build`): public pages 103–124 kB, admin 197–242 kB (shared 103 kB).

## Accessibility checks

Done: keyboard paths (skip link, sheet focus handling, focus-visible rings incl. file pickers), semantic buttons and links (no clickable divs), labelled inputs, `aria-current`, `aria-invalid`, `role=alert`, `aria-live` counts, contrast measured (all text ≥ 4.5:1, control borders ≥ 3:1), reduced motion, one H1 per page, status not colour-only.
Not done: an automated axe scan (`@axe-core/playwright` is not installed and adding it would change `package.json`, which Codex owns) and screen-reader testing on real VoiceOver or TalkBack.

## Not verifiable here

On-screen keyboard overlap on real devices, real Supabase Auth redirects on mobile, real file pickers on iOS and Android (input `accept` lists are unchanged), Messenger app hand-off on devices, and dynamic font loading on slow real networks.
