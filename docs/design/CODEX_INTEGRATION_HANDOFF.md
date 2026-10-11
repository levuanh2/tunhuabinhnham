# Codex Integration Handoff: Warm Editorial V2 (+ mobile-first addendum)

| | |
|---|---|
| Design branch | `design/warm-editorial-v2` (local only, **not pushed**) |
| Worktree | `E:\Tunhuabinhnham-design` |
| Base commit | `2715b8f54d4d4b77f9725ba3b6c3dec0ecb60248` (`main`, "chore: establish secure project baseline") |
| Commits | one commit on top of the base: "feat(web): Warm Editorial redesign with mobile-first UX" |
| Merge / deploy | Not merged, not pushed, not deployed. No Supabase writes, no migrations. |

## Codex-owned files: untouched

`package.json`, `package-lock.json`, `apps/web/package.json`, `next.config.ts`, `open-next.config.ts`, `wrangler.jsonc`, `playwright.config.ts`, `src/middleware.ts`, `src/app/api/**`, `src/lib/api.ts`, `src/lib/admin-api.ts`, `src/lib/admin-media.ts`, `src/lib/supabase/**`, `apps/api/**`, `supabase/**`.
No dependency was added. Everything uses the installed Next 15 / React 19 / Tailwind 4 / lucide / Playwright.

## Overlap with Codex Gate B.2

At handoff time Codex's tree (`fix/postcss-security`) modifies only `package.json` (a `packageExtensions` postcss pin) and `package-lock.json`. **No file overlaps with this branch.**
Watch these points if Gate B.2 also upgrades Next.js or React:

- `src/app/layout.tsx` uses `export const viewport: Viewport` (Next ≥14) and `next/font/google` (`Be_Vietnam_Pro`, `Newsreader`, `variable` on `<html>`). Keep the variables on `<html>`, or Vietnamese marks break in the display font.
- `components/sticky-contact.tsx` uses the React 19 boolean `inert` prop.
- `components/sheet.tsx` relies on native `<dialog>.showModal()` (all evergreen browsers; Safari ≥15.4).
- Tailwind 4 syntax: `@theme`, `@layer components`, the legacy `!` important prefix (`md:!static`), `has-[:focus-visible]:`, `aria-[current=page]:`. A Tailwind 4.x minor bump is expected to keep these working. Re-run the screenshots if the `!` prefix behaviour changes.

## Files modified (apps/web)

Pages: `src/app/(public)/{page,layout}.tsx`, `san-pham/page.tsx`, `san-pham/[slug]/page.tsx`, `tin-tuc/page.tsx`, `tin-tuc/[slug]/page.tsx`, `gioi-thieu/page.tsx`, `lien-he/page.tsx`, `src/app/admin/login/page.tsx`, `src/app/admin/(cms)/{page,danh-muc/page,bai-viet/page,banner/page,cai-dat/page,san-pham/page,san-pham/moi/page,san-pham/[id]/page}.tsx`
Global: `src/app/globals.css`, `src/app/layout.tsx`
Components: `admin-shell.tsx`, `admin-media-upload.tsx`, `contact-button.tsx`, `product-card.tsx`, `site-footer.tsx`, `site-header.tsx`, `features/admin/product-form.tsx`
Tests: `e2e/staging-cms.spec.ts` (made layout-agnostic: product link instead of a table row; opens the admin drawer before logout on phones)

## New files

- Components: `sheet.tsx`, `site-nav.tsx`, `product-filters.tsx`, `product-gallery.tsx`, `sticky-contact.tsx`, `post-card.tsx`, `section-heading.tsx`
- Lib: `lib/messenger.ts` (+ `messenger.test.ts`), with the same allowlist rules moved out of `contact-button.tsx`; `lib/date.ts`
- Tests and QA: `e2e/responsive.spec.ts` (skipped unless `E2E_MOCK_API=1`), `e2e/fixtures/mock-api.mjs` (local fixture plus fake auth, 127.0.0.1 only), `e2e/visual-qa/{shoot,shoot-states,vitals}.mjs`
- Docs: `docs/design/*.md`, `docs/design/screenshots/{before,after,after/admin,states}` (about 12 MB of JPEG)

## Design tokens

See `DESIGN_SYSTEM_WARM_EDITORIAL.md`: `bg #FAF7F2`, `surface #FFF`, `muted #F3EEE7`, `line #E8DFD2`, `sand #A78B73`, `primary #67503F`, `primary-hover #4F3C2E`, `ink #292724`, `ink-soft #706B64`, plus the added `control #968A7D` (input borders, 3.37:1), `primary-soft`, `success`, `danger`.

## Test results (final)

typecheck pass · eslint pass · Vitest 4/4 · `next build` pass · `build:cloudflare` (OpenNext) pass · Playwright 23 passed / 5 skipped (Chromium desktop + WebKit iPhone 13, fixture data). Lighthouse not run (no network). Lab vitals are in `MOBILE_VISUAL_QA_REPORT.md`.

## Behaviour changes worth reviewing

1. **Bug fix, product editor:** the category `<select>` remounts once categories load (`key`). Previously, editing an existing product showed "Chưa phân loại" and saving cleared its category.
2. Admin product list search now calls the existing `GET /admin/products?search=` (used by the staging spec). The status filter is client-side over the returned page.
3. Image reorder (← →) in the product editor rewrites `sort_order` before save. The payload shape is unchanged.
4. Homepage requests `page_size=12` (was 8) to fill "Nổi bật" and "Hàng mới về", and also reads `site-settings`.
5. Login shows Supabase errors inline (`role=alert`) instead of a toast. Logout shows a toast if `/api/auth/logout` fails (previously silent). The success sequence is unchanged.
6. The listing filter form now sends `max_price` (already in the page's allowlist and the API).

## Known issues / follow-ups

- **CMS data:** `site_settings.store_name` is "Tủ Hòa Bình Nhâm". The owner must change it to **Tủ Nhựa Bình Nhâm** in Admin, then Cài đặt. This was not hardcoded and no database write was made.
- The real database has no products, banners or posts yet. Visuals were verified with fixtures only.
- Admin with real Supabase Auth is not verified (no credentials). Run `staging-cms.spec.ts` on staging after merge.
- The post editor is still an HTML textarea (no mobile rich-text toolbar). `window.confirm` is used for delete/hide.
- `apps/web/.env.local` in the design worktree points at the fixture server and is gitignored. Do not copy it.

## Recommended integration

1. Let Gate B.2 land on `main` first.
2. `git rebase main design/warm-editorial-v2` (or merge `main` into it). There are no textual conflicts with the current Gate B.2 diff.
3. In the rebased tree: `npm ci`, then `npm --workspace apps/web run typecheck && npm --workspace apps/web run lint && npm --workspace apps/web test && npm --workspace apps/web run build && npm --workspace apps/web run build:cloudflare`.
4. Visual check: start `node apps/web/e2e/fixtures/mock-api.mjs` and a server on :3100 with a fixture `.env.local` (see the header of `responsive.spec.ts`), then run `E2E_MOCK_API=1 E2E_BASE_URL=http://localhost:3100 npx playwright test`.
5. Open a PR from the branch for human review. Do not fast-forward without review.
