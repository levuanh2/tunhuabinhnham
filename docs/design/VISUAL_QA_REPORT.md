# Visual QA Report

## Setup (all from Claude's isolated workspace)

- Server: `next start -p 3100` (production build) from `E:\Tunhuabinhnham-design\apps\web`. Earlier iterations used `next dev -p 3100`. The Codex instance on :3000 was **never** used for screenshots. During the session, :3000 stopped listening. Claude's scripts only terminated processes listening on :3100.
- Data: `apps/web/e2e/fixtures/mock-api.mjs` on 127.0.0.1:8100 (read-only fixtures plus fake Supabase Auth). The real local API holds 0 products, so real-data layouts could not be shown.
- Engines: Playwright 1.64. **Chromium** (desktop viewports and Android-like phone emulation with touch) and **WebKit** (iPhone 13 device profile). No real devices were used.
- Scripts: `apps/web/e2e/visual-qa/shoot.mjs` (full-page screenshots plus a per-page horizontal-overflow and H1 report), `shoot-states.mjs` (interaction states).

## Evidence

| Set | Pages | Viewports | Files |
|---|---|---|---|
| Before (`screenshots/before/`) | home, products, detail, news, article, contact, about, login, empty search | 360, 390, 768, 1024, 1440 | 45 + `report.json` |
| After, public (`screenshots/after/`) | home, products, detail, news, article | 320, 360, 375, 390, 412, 430, 768, 1024, 1440 | 45 + `report.json` |
| After, public extra | contact, about, admin login, empty search | 360, 390, 768, 1024, 1440 | 20 + `report-extra.json` |
| After, admin (`screenshots/after/admin/`), fake auth | dashboard, product list, product editor, new product, categories, posts, banners, settings | 360, 390, 768, 1024, 1440 | 40 + `report.json` |
| States (`screenshots/states/`) | see below | 390×844 | 10 Chromium + 10 WebKit (`-webkit`) |

Overflow: **0 / 130** after-screens and 0 / 45 before-screens have `scrollWidth > clientWidth`. Every page has exactly one `<h1>`.

## Audit results (after)

| Item | Result | Notes |
|---|---|---|
| Colour hierarchy | Pass | Cream page, white surfaces, brown only on actions, green/red only on status |
| Typography | Pass | Vietnamese diacritics verified in headings, buttons, labels and inputs (after the font-variable fix). Before the fix, "nhu cầu" and "về" rendered with detached marks; see the design-system doc. |
| Spacing / grid | Pass | 12-col hero and detail, consistent 16/24px gutters, `shell` max 1240px |
| Product imagery | Pass (fixtures) | 4:5 cards, 4:5 gallery, 4:3/5:4 hero, `object-cover`, `sizes` set. **Real photography not yet available.** |
| Header / mobile menu | Pass | `state-mobile-menu-open*.jpg`, `state-search-focus*.jpg`. At 768px the desktop nav used to wrap, so desktop nav now starts at 1024px. |
| Footer | Pass | Stacks on phones, 44px link rows |
| Buttons | Pass | Pill, ≥44px (36px `.sm` only for dense admin secondary actions) |
| Admin forms | Pass | `state-admin-editor-validation*.jpg`: inline error with `aria-invalid` |
| Admin tables | Pass | Card list on phones, table ≥768px. Categories use a list everywhere |
| Dialogs | Pass | Native `<dialog>`: menu, filter sheet, admin drawer. Browser `confirm()` is still used for delete/hide (unchanged behaviour) |
| Empty states | Pass | `search-*.jpg` (no results), homepage with no products (code path reviewed), admin empty lists |
| Contrast | Pass | Measured table in the design-system doc. Input borders raised to 3.37:1 |
| Write-failure feedback | Pass | `state-admin-save-blocked-feedback*.jpg`: the fixture rejects writes (403) and the toast shows the API message |

### States captured

`state-mobile-menu-open`, `state-search-focus` (search field focused on open), `state-filter-sheet-open`, `state-sticky-cta`, `state-login-validation`, `state-login-wrong-password` (inline alert), `state-admin-drawer-open`, `state-admin-editor-validation`, `state-admin-editor-category` (verifies the category bug fix: shows "Tủ ngăn kéo"), `state-admin-save-blocked-feedback`.

## Blocked / not verified

- **Real admin with real Supabase Auth: BLOCKED** (no credentials provided). Admin screens were verified with the local fake auth and read-only fixtures. Real upload, replace and remove, real save plus `/api/revalidate`, and real logout against Supabase were **not** exercised. Those paths' logic is unchanged and is covered by `e2e/staging-cms.spec.ts` once staging credentials and write approval exist.
- Real product photography and real CMS banners (none in the database).
- Lighthouse (could not be installed: npm network blocked in the sandbox). See the mobile QA report for lab vitals measured with Playwright.
