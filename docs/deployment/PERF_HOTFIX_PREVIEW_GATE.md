# Performance hotfix: preview gate

Date: 2026-10-23 (Asia/Saigon). Production was not changed: 100% `f4fd8f1a` (source `e681cca`) throughout.

**Verdict: PERF_HOTFIX_PREVIEW_PASS**, with one open item that needs separate owner approval: an authenticated purge / media-delete check on the preview (see Gate C, "Not verified").

## Identity

| | Value |
|---|---|
| N source | `0cfcd7d` on `fix/perf-image-cache` (code identical to `981211b`, Codex R4 APPROVE; `0cfcd7d` changes docs only) |
| N Worker version | `ace736be-c3d6-443e-a454-d7bae8c69681` — https://ace736be-tunhuabinhnham-web.tunhuabinhnham.workers.dev |
| N build ID | `8Bn18QE6MW8hA1q7muWLF`; assets archived in `apps/web/.deploy-assets/0cfcd7d` (45 files) |
| P′ source | `e681cca` (= P) + assets of N `0cfcd7d`, `1ab6f7c`, `3e8c5f0` |
| P′ Worker version | `b2d3421d-5d82-47e7-b7eb-fa427f4872dc` — https://b2d3421d-tunhuabinhnham-web.tunhuabinhnham.workers.dev |
| P (live) | `f4fd8f1a-afe5-4d38-9a02-a6a9fe366c57`, source `e681cca` |

Both uploads: `wrangler versions upload` only, no `versions deploy`. Secret scan PASS on both bundles. N carries P, `1ab6f7c` and `3e8c5f0` assets (59 files).

## Gate A — safety

1. Credentials: the gateway sends an image to the cached entrypoint only through `isEdgeCacheableRequest`, which rejects Supabase session cookies (plain, chunked, `__Host-`/`__Secure-`) and `Authorization`. Unit tests (`worker-image.test.ts`) and the real preview (below) confirm no HIT and `private, no-store` for every credential form, including after a warm entry exists, and an auth-first request does not seed the cache.
2. Cache key: Workers Cache keys on version + full URL, so `url`, `w`, `q` are all in the key; the output format depends on `Accept`, which is not in the key, so only clients with an explicit `image/webp` (q > 0) share entries. Preview: widths 384/640/1080 of one source are three distinct HITs with their own sizes and hashes.
3. Fallback target: `remotePatterns` now allows only `fyaourksnjeldsvuedox.supabase.co/storage/v1/object/public/**` (from `NEXT_PUBLIC_SUPABASE_URL` at build). OpenNext validates before any fetch, so other projects, `/object/sign/`, `/object/authenticated/`, plain http and arbitrary hosts get 400 with no `Location` (preview-verified).
4. Fallback is a private 302, never stored; 4xx/5xx, redirects, non-images and `Set-Cookie` responses are not stored (unit + preview).
5. Images Free: 5,000 unique transformations / calendar month; uniqueness = source × parameters, format and quality excluded. Over the limit, new transforms return 9422 and are not billed; cached ones keep serving. In this hotfix a 9422 throws inside the binding and falls back to the original upload. Today 22 public images, worst case 16 widths each = 352 / 5,000. The old `**.supabase.co` pattern let anyone spend this quota; closed by `981211b`.
6. Purge: one tag (`public-html`) on the `PublicCache` entrypoint covers every page and every image variant; media DELETE now calls `/api/revalidate` after the delete, and a failed purge shows the admin a warning. Browser copies cannot be purged: up to 1 h (`max-age=3600`); edge copies at most 1 day (`s-maxage=86400`).
7. Admin, auth, API, RSC: unchanged code paths; preview shows `/admin`, `/admin/login`, `/api/revalidate` and forged `_rsc` private/no-store.
8. No change to Render, Supabase, DNS or plans.

## Gate B — build and upload

- Unit 56/56, typecheck, lint, OpenNext build, `wrangler deploy --dry-run` (8,074 KiB / gzip 1,644 KiB), secret scan: PASS.
- Codex: R1, R2 REQUEST_CHANGES (all fixed), R3 APPROVE `a5bee98`, R4 APPROVE `981211b` (one P3 doc note, fixed in `0cfcd7d`).

## Gate C — real Cloudflare preview

`image-cache-probe.json` (40 checks, PASS):

- Product, large product, banner and post image: cold MISS → warm HIT twice; identical WebP bytes; width ≤ requested; `public, max-age=3600, s-maxage=86400`. Warm HIT 110–580 ms vs cold 250–3,200 ms.
- Cookie, chunked cookie, Authorization, cookie + Authorization: never HIT, `private, no-store, max-age=0`. Non-WebP and `image/webp;q=0` clients bypass the shared cache. (OpenNext itself still answers `webp;q=0` with WebP by substring match — pre-existing upstream behaviour, live today; it is not a cache collision.)
- Disallowed quality and missing source: 4xx, not cached, no redirect. HEAD served from the cache.
- Unauthenticated / invalid-token purge: 401, the warm entry stays HIT.

`browser-smoke.json`: Chromium and WebKit, desktop and mobile; home, catalogue, category, product + gallery, news list + article, contact, about; category tab navigation.

- 0 image request failures, 0 fallback redirects needed, 0 prefetch requests, 0 HTTP ≥ 400 on the origin, 0 console errors, no 1102/1027 pages.
- WebKit reports 1–3 gallery slides not loaded: they are `loading="lazy"` slides off-screen inside `aria-hidden`; production shows the same; after a swipe all images load (verified on both engines).

Not verified (needs owner approval): a successful authenticated purge and a media delete on the preview. Both need an Admin session; the delete also writes production storage and DB. Unit and local workerd tests cover the code path; the preview proves only the fail-closed side. `wrangler tail` does not capture requests made through version preview URLs, so preview CPU and exceptions must be read in the dashboard (filter by version `ace736be`).

## Gate D — performance

Single session on real Cloudflare (production backend, read-only):

| | P cold | N cold | P warm | N warm |
|---|---|---|---|---|
| `/san-pham` load / LCP | 6.9 s / 2.5 s | 1.9 s / 0.9 s | 2.3 s / 0.6 s | 2.3 s / 1.2 s |
| tab click to idle p50 / p95 | 106 / 1,657 ms | 128 / 2,114 ms | 110 / 126 ms | 145 / 251 ms |
| RSC requests per session | 28 | 10 | 30 | 10 |
| image TTFB p50 | 875 ms | 386 ms | 695 ms | 204 ms |

With a warm cache and one visitor, a single click is slightly slower without prefetch (+35 ms p50, +125 ms p95); every visit makes ~2/3 fewer Worker requests and ~half the backend calls.

1 / 5 / 10 concurrent sessions, local workerd, API replay limited like Render Free (4 concurrent, measured service times), cold cache, same day (`bench-gateD.jsonl`):

| sessions | click p50 / p95 `e681cca` | click p50 / p95 `0cfcd7d` | API calls / session | image failures |
|---|---|---|---|---|
| 1 | 1.56 / 1.89 s | 1.09 / 2.23 s | 43 → 21 | 0 → 0 |
| 5 | 3.57 / 8.0 s | 1.59 / 2.9 s | 43 → 21 | 8 → 0 |
| 10 | 7.28 / 20.0 s | 3.40 / 6.9 s | 43 → 21 | 15 → 0 |

Worker CPU per request is not observable for preview URLs; compare in the dashboard after P′/N. Render latency per call is unchanged (0.6–1.2 s; Singapore → Sydney DB); the hotfix halves the number of calls.

## Gate E — release plan (not executed; needs owner approval)

Standard procedure: `TASK_P1_ASSET_VERSION_SKEW.md`. Run from `E:\Tunhuabinhnham\apps\web` (it now holds `.deploy-assets` and `.env.production.local`).

Skew evidence: P′ preview and N preview each serve all 52 files of P + N (`verify-*.txt`, 30 s clean soak); P′ HTML references exactly P's assets; local mixed-version simulation with retained assets: NO_SKEW_FAILURE both ways.

1. Step A: `npx wrangler versions deploy b2d3421d-5d82-47e7-b7eb-fa427f4872dc@100% --message "P′ e681cca + N 0cfcd7d assets"`, with `npx wrangler tail tunhuabinhnham-web` running.
2. Hard gate (≥ 5 min): `node scripts/verify-assets-live.mjs https://tunhuabinhnham.com .deploy-assets/0cfcd7d --soak 300 --timeout 1800` must exit 0. Exit 1: stop, roll back to P.
3. Step B: `npx wrangler versions deploy ace736be-c3d6-443e-a454-d7bae8c69681@100% --message "N perf hotfix 0cfcd7d"`, tail running.
4. After N: `verify-assets-live.mjs https://tunhuabinhnham.com .deploy-assets/0cfcd7d .deploy-assets/e681cca --soak 300`; production smoke = `node docs/qa/evidence/perf-hotfix/preview/image-cache-probe.mjs https://tunhuabinhnham.com <out>` (read-only; unique probe query keys) + `preview-browser.mjs https://tunhuabinhnham.com <out.json>` (copy into `node_modules/` to resolve Playwright); 0 `/_next/static` 404s, 0 exceptions in the tail; Cloudflare dashboard: exceptions and CPU p50/p90 vs the 2026-10-23 baseline (69.6 / 247 ms).

Rollback:

| Phase | Target |
|---|---|
| Before step A | stay on P `f4fd8f1a` |
| Step A live, gate failing | P: `npx wrangler versions deploy f4fd8f1a-afe5-4d38-9a02-a6a9fe366c57@100%` |
| Step B started | P′: `npx wrangler versions deploy b2d3421d-5d82-47e7-b7eb-fa427f4872dc@100%` |

Retention after release: keep `.deploy-assets/{0cfcd7d,e681cca,1ab6f7c}`; `3e8c5f0` and `70dac36` may go.

## Remaining risks

- Authenticated purge / media delete not yet proven on Cloudflare (owner approval needed).
- Browser copies of a deleted image live up to 1 h; edge copies up to 1 day if a purge fails (admin is warned).
- Each version switch starts a cold cache: two cold starts for P′ then N.
- OpenNext's 7 s source-fetch signal and its substring `Accept` check are upstream behaviour; residual internal `TimeoutError`s fall back to the original image.
- Backend latency (Render Singapore ↔ Supabase Sydney) is untouched.

## Authenticated purge (runner v3, 2026-10-23 09:23:17Z) — PURGE_ISOLATION_ACCEPTED_RISK

Runner verdict `AUTH_PURGE_PREVIEW_INCONCLUSIVE` (`docs/qa/evidence/perf-hotfix/purge/purge-probe-result.json`, analysis in `ANALYSIS.md`). Owner decision: **PURGE_ISOLATION_ACCEPTED_RISK**; the HTML purge verdict stays INCONCLUSIVE.

| Gate | Result | Evidence |
|---|---|---|
| Unauthenticated / invalid-token purge refused | PASS | 401 private/no-store |
| Rejected purges evict nothing (image, page) | PASS | SIN HIT Age 65 / 39, older than the rejected purges |
| Admin login, authenticated purge | PASS | 200, purge 200 private/no-store |
| Production cache untouched by the preview purge | PASS | LHR HIT Age 60 > 20.2 s since the purge |
| Preview image purged | PASS | SIN HIT before, SIN MISS after |
| Preview HTML purged | **INCONCLUSIVE** | the client never returned to SIN; 11 post-purge samples (HKG, CDG) showed no HIT older than the purge |
| Logout revokes the session; revoked token cannot purge | PASS | 204; 401 |

Accepted risk: tag purge of HTML on the release version is shown only indirectly (same tag and entrypoint as the image, which was proven purged; no stale HTML observed). If an admin save ever failed to refresh public HTML, the edge copy still expires within `s-maxage=300` s.
