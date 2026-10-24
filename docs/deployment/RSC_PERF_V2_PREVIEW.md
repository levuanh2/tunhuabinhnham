# RSC V2 (option D): preview

Date: 2026-10-24. Owner approved option D for PREVIEW only (not production). Production unchanged: Worker `ace736be` at 100 % (checked with `wrangler deployments status` after the upload), backend `1ab6f7c` on Render.

**Verdict: BLOCKED — no preview backend.** The frontend preview is uploaded and passes its smoke test against the current production API (which ignores `?related=4`: the related section is hidden, the designed old-backend fallback). Option D end to end (related products from `?related=4`, 2 Render calls per product view, the benchmark on real Render) needs a backend with `9448d43`, and no preview backend exists (§4).

## 1. Versions

| | |
|---|---|
| Source | `perf/rsc-nav-v2` `852126e` (pushed to origin 2026-10-24, new branch) |
| Codex | round 2 APPROVE on the final code (`dad8c90`; `852126e` only edits the report verdict), see `RSC_PERF_V2_GATE.md` §7 |
| Frontend preview | Worker version `fae6efa2-4153-411c-9987-55f2f6ccfb87`, https://fae6efa2-tunhuabinhnham-web.tunhuabinhnham.workers.dev — `wrangler versions upload` only (tag `rsc-v2-852126e`), never deployed. Build `D80pnLqeOfv9mcYUjRa2D`, clean `.next`, production env; image allowlist `fyaourksnjeldsvuedox.supabase.co`; no test hosts; bundle secret scan PASS. Assets: own build + `0cfcd7d` + `e681cca` merged (12 copied, 59 hashed files); own assets archived in `apps/web/.deploy-assets/852126e` (45 files) for a later P′. |
| Backend for D | branch `preview/rsc-v2-api` (local, not pushed) = `origin/deploy/c2-preview` `1ab6f7c` + cherry-pick of `9448d43` → `45da4c1`. API suite: 133 pass, the same 5 pre-existing admin failures; ruff and mypy pass. Not deployed anywhere. |
| Push secret scan | 11 commits / 123 objects not on origin: no env value or secret pattern (2 false positives: the public JWT audience `authenticated` in the e2e fixture, a scanner pattern quoted in a doc) |

## 2. Smoke (`preview/preview-smoke.mjs` → `preview/smoke-old-backend.json`): SMOKE_PASS 19/19

Against the preview URL with the production API (read-only GETs; one token-less POST to the preview's own `/api/revalidate`):
- `/`, `/san-pham`, category, `/tin-tuc`, `/lien-he`, `/gioi-thieu`: 200, all referenced `_next/static` files belong to this build, security headers, `public, max-age=0, s-maxage=300` (TTL unchanged by RSC V2).
- Production API `GET /products/tu-nhua-4-canh-4?related=4`: 200, the parameter is ignored (no `related` field) — the old-backend case of the rollout.
- Product page: 200, canonical, JSON-LD, `/_next/image` images; no "Sản phẩm cùng loại" section (expected with this backend: `product.related ?? []`).
- Post page 200. Anonymous HTML MISS → HIT → HIT (1364 / 428 / 88 ms). Cookie and Authorization requests: `private, no-store`, never a HIT. `/admin`, `/admin/login`, `/api/revalidate` private; token-less purge 401; unknown product 404 not cached; `/san-pham/` keeps its 308.
- Image transform: 200 WebP, `public, max-age=3600, s-maxage=86400` (unchanged).

Not checked on the preview: an authenticated purge (needs an Admin session; saves write production data), a live old-slug 301 (no known old slug in production data; code path unchanged and covered by API and e2e tests).

## 3. Browser probe (`nav-probe.mjs` → `preview/nav-preview.json`), one session each

| profile | prefetch | click → feedback | click → content, MISS | click → content, HIT |
|---|---|---|---|---|
| Chromium desktop | 0 | 39–74 ms | 956–2009 ms | — |
| WebKit desktop | 0 | 136–210 ms | 1300–3082 ms | — |
| WebKit iPhone 13 | 0 | 138–242 ms | 1434 ms (one MISS) | 266–726 ms |

Feedback includes Playwright's own click latency (~50 ms Chromium, ~175 ms WebKit; in-page 8–10 ms). Back/Forward served from the router cache (12–53 ms, no request). The product page here makes 2 API calls but without related products, so its timing (1.1–1.3 s TTFB cold) is **not** a measurement of D.

Load benchmark (5/10 sessions) was not run on the preview: it would put that load on the production API, and without `related` it would not measure D.

## 4. Blocker: preview backend

The preview Worker calls the production API (`NEXT_PUBLIC_API_URL` is baked in at build). To preview D end to end, one of:

| option | what | risk / cost |
|---|---|---|
| **A (recommended)** | Deploy `45da4c1` (= `1ab6f7c` + `9448d43`) to the production Render service — this is rollout step 1 anyway. The change is additive: `ace736be` ignores the new `related: []` field and never sends `related`. Then re-run this smoke and the probe on the same preview `fae6efa2` (no rebuild), plus a light benchmark, and read Render logs for calls per product view. | A production backend change (owner approval). Rollback: Render deploy of `1ab6f7c`, safe with every Worker version (a new Worker only hides the section). |
| B | A second Render Free service from `preview/rsc-v2-api` + a preview Worker rebuilt with its URL. | Owner dashboard work; same production DB and secrets; **Render Free's 750 instance hours per workspace are shared**, so a second awake service can starve the production API; CORS for the preview origin. |
| C | Local API + public tunnel | Rejected: exposes a server holding production DB credentials. |

## 5. Rollback

Nothing to roll back for the preview (no deploy). Delete nothing: an uploaded version is inert. Production rollout and rollback steps: `RSC_PERF_V2_GATE.md` §8 (only after the preview passes end to end and a new owner approval).
