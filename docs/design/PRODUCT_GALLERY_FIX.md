# Bugfix: product detail image gallery

Date: 2026-10-13.
- Branch `fix/product-gallery`, from `origin/integration/warm-editorial-v2` @ `5e3b349`. Its web code equals production Worker `37eef86b`.
- Status: **not deployed**.
- Verdict: **READY_FOR_REVIEW**.

## Root cause (measured on production, Chromium, `/san-pham/tu-nhua-4-canh`)

| Probe | Value at 1440 px |
|---|---|
| Gallery region | 633 × 349 |
| `grid-template-columns` | `72px 545.297px` |
| Children of the grid | **1** |
| Main image wrapper | **72** × 349 |
| Rendered `<img>` | **72 × 90** |

`ProductGallery` used `md:grid-cols-[72px_minmax(0,1fr)]`, with a 72 px column meant for the thumbnail rail and `md:order-2` on the main image. The thumbnail list is rendered only when there is more than one image. With exactly one image the main image is the grid's only child, so it fills the **first** track: the 72 px thumbnail column. At 390 px the grid has one column, so phones were not affected.

The image itself was ruled out:
- the original in Supabase Storage is a 960 × 1280 JPEG (69 KB) with no baked-in padding;
- `_next/image` returned the expected 640/750/1080 variants, capped at the original width;
- no failed image requests, no console errors.

The fixture data hid the bug: every fixture product has three images.

Secondary issues:
- `object-cover` in a 4:5 frame cropped the 3:4 photo at the sides;
- empty `alt_text` (the admin form default) produced `alt=""` on product photos.

## Fix (`apps/web/src/components/product-gallery.tsx`)

- Single-column gallery: main image first, thumbnails **below**, at full gallery width at every breakpoint. A 1-image product can no longer land in a narrow track.
- 4:5 frame (reserved before load: no layout shift) on the Warm Editorial cream background, `object-contain` with inner padding, so whole cabinets show, never cropped. Portrait, landscape and transparent images all fit.
- Thumbnails (64/80 px, `sizes="80px"`) scroll horizontally. Clicking one selects the image; the counter is always shown when there are several images.
- Swipe kept: native scroll-snap. A programmatic scroll (thumbnail click, arrow key) no longer has its selection overwritten by intermediate scroll positions. Fixed race: a fast click then arrow key used to select the wrong image.
- Lightbox:
  - click or Enter on the main image opens a native `<dialog>` (focus trap, Escape, focus return, background scroll lock);
  - close button (focused on open), previous/next buttons, arrow keys, counter, wrap-around;
  - loads its full-size image only when opened.
- Error states:
  - a broken image shows "Không tải được ảnh" in the frame, the thumbnail and the lightbox;
  - no images: the existing "Chưa có ảnh sản phẩm".
- `alt` falls back to the product name.
- Performance:
  - the first image keeps `priority`; the others are lazy;
  - `sizes` is capped at 640 px on large screens, so no larger downloads;
  - Workers Cache policy (eligibility, key, headers, TTL) and server code are unchanged.
  - Worker CPU on a cache MISS was **not benchmarked**. The client component is still server-rendered, so a MISS serialises slightly more markup; no material impact is expected, but none is claimed.

Not done, deliberately:
- No CSS `transform: scale`.
- No `object-scale-down`. With `srcset`, the browser derives the intrinsic size from the *requested* width. An original smaller than the variant (e.g. 960 px served for a `w=1920` retina request) would then render at about half size.

## Low-resolution originals

`object-contain` scales a small original up to the frame.
- The current photo is 960 px wide: sharp in the 633 px gallery, slightly soft in a full-screen lightbox on retina.
- Recommendation: upload originals **≥ 1600 px on the long side**.
- Optional follow-up: a size warning in the admin upload (read the dimensions in `validateMediaFile`).

## Screenshots

`docs/design/screenshots/product-gallery/`:
- `before/`: production, 1440 and 390, Chromium and WebKit.
- `after/`: 1920 / 1440 / 768 / 390 / 375, single and multiple images, plus the lightbox. Fixture API, local workerd, the real photo from the bug report.

| After (both engines) | 1920 | 1440 | 768 | 390 | 375 |
|---|---|---|---|---|---|
| Main image | 633 × 792 | 633 × 792 | 704 × 880 | 358 × 448 | 343 × 429 |
| Overflow / console errors | none | none | none | none | none |

## Tests

| Suite | Result |
|---|---|
| TypeScript, ESLint | PASS |
| Vitest | 23/23 |
| OpenNext build | PASS |
| Playwright on local workerd + fixture (desktop + iPhone 13), `--workers=1` | **59 passed, 0 failed** (Workers Cache, auth, RSC, SEO and the Product UX suites included) |

New `e2e/product-gallery.spec.ts` covers:
- **G1:** one image fills the column at 1920/1440/768/390/375; 4:5 frame; no thumbnails; `object-fit: contain`; alt fallback; no overflow. Negative control run: on the old gallery, G1 fails with `Received: 72`.
- **G2:** several images: thumbnails below; selection; arrow keys; Enter opens the lightbox with focus on close; arrows and next button with wrap-around; the zoomed image is larger; Escape closes with the selection in sync **and focus on the visible slide**; phone thumbnails scroll; tap to open and close.
- **G3:** broken image fallback; empty state; the 4:5 frame is measured while `/_next/image` is held back and keeps its size after release; cumulative layout shift < 0.1.

Real-browser probe: Chromium and WebKit, single and multiple images, five widths, 0 console errors (`after/report.json`).

SEO and metadata are untouched: page metadata, JSON-LD and canonical live in `san-pham/[slug]/page.tsx`, which is unchanged.

## Production deploy (2026-10-13, owner-approved): PRODUCTION_PASS_WITH_RISK

| | |
|---|---|
| Git | `fix/product-gallery` pushed at `70dac36`. Base `5e3b349` = `integration/warm-editorial-v2` HEAD; app code equal to the previous production build source `443a937`; diff limited to the gallery, its tests and docs; no dependency change |
| Build | OpenNext production build of `70dac36` (public env only). Bundle scan: no secrets; same matches as before (publishable anon key, literal JWT audience) |
| Preview | Worker version `d65ec5a0-c59c-4ed9-9909-80dd1cd70231` (alias `gallery-…workers.dev`) |
| Production | `d65ec5a0-c59c-4ed9-9909-80dd1cd70231` @100%, deployment created 2026-10-13T14:13:22Z |
| Rollback | `npx wrangler versions deploy 37eef86b-8124-48b6-84ab-eb24508073b6@100%` (not needed) |
| Backend | unchanged (Render `fa76152`); no Supabase, DNS or plan change |

**Preview smoke (PASS).** On the real product `/san-pham/tu-nhua-4-canh`:
- main image 633 × 792 at 1920/1440, 704 × 880 at 768, 358 × 448 at 390, 343 × 429 at 375, `object-fit: contain`;
- the lightbox opens; Escape closes it and focus returns to the zoom button;
- Chromium + WebKit, 0 console errors, 0 5xx, 0 overflow.

Also on the preview:
- public routes MISS → HIT, 404 not cached;
- admin BYPASS `no-store`, corrupted cookie 307;
- canonical and JSON-LD intact;
- RSC replay matrix identical to Gate C3.1;
- 6 browser visits, 0 errors;
- 80 mobile shots, 0 overflow.

Multi-image behaviour cannot be checked on production data (the only product has one image). It is covered by G2 on the fixture.

**Production verification (after cutover, on fresh HTML).** The product page was MISS then HIT. The cache key includes the Worker version, so no HTML from `37eef86b` was served, and the page carries the new markup (`data-slide`, no 72 px rail). Results:
- same measurements as on the preview, in both engines and at all five widths (`screenshots/product-gallery/production/`);
- homepage and category pages MISS → HIT;
- admin BYPASS;
- RSC matrix as above;
- 80 mobile shots with no overflow;
- all homepage assets 200.

Tail 14:13:38–14:21:02Z: 281 invocations, all `ok`, 0 exceptions, 0 5xx, no 1102/1027, CPU p50 16 ms / p95 234 ms (unchanged profile).

**Risk observed: asset version skew during cutover.**
- From 14:13:51 to 14:15:03Z (~72 s), 11 requests for the new stylesheet `/_next/static/chunks/1r_u2-zj6a_zg.css` were answered **404 by the old version `37eef86b`**, whose asset manifest does not contain it.
- Meanwhile HTML was already rendered by `d65ec5a0`. A visitor in that window could get an unstyled page; one of the first checks after cutover saw it.
- The 404s were not cached (`BYPASS`), and none occurred after 14:15:03Z.
- This is the version-skew risk noted in Gate C3.1, now observed. Mitigations for the next frontend deploy, as a separate task:
  1. enable OpenNext/Cloudflare skew protection, so that assets and RSC requests are pinned to the deployment that rendered the HTML; or
  2. keep previous builds' hashed assets available across a deploy;
  3. at minimum, deploy outside peak hours and re-check assets ~2 minutes after cutover.

**Follow-up needing approval:** merge `fix/product-gallery` into `integration/warm-editorial-v2` (fast-forward from `5e3b349`). Until then, a build from `integration` would bring the 72 × 90 bug back.
