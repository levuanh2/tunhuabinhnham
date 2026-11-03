# RSC V2 (option D): preview

Date: 2026-10-24. Owner approved option D for PREVIEW only (not production). Production unchanged: Worker `ace736be` at 100 % (checked with `wrangler deployments status` after the upload), backend `1ab6f7c` on Render.

**Verdict: RSC_PERF_V2_PRODUCTION_READY** (§7), after the owner-approved backend release `45da4c1` (§6). Owner confirmation left: Render log call counts at the probe timestamps. Production frontend still `ace736be`. Sections 1–5 describe the first preview round against the old backend.

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

## 6. Backend release (owner authorization 2026-10-24, option 1)

**Gate 1 (before deploy): PASS.**
- `1ab6f7c..45da4c1`: 4 API files only (`public.py`, `catalog.py` repository + schema, test); `git patch-id` identical to `9448d43` (Codex round 2 APPROVE). No migration, `alembic`, `supabase/`, env, `config.py`, `main.py`, CORS or `render.yaml` change.
- API suite: candidate 133 pass / baseline `1ab6f7c` 132 pass; the same 5 admin tests fail on both (identical names). ruff, mypy pass.
- Response shape (in-memory, both checkouts): `GET /products/{slug}` keeps every baseline field, adds only `related: []`; `?related=4` → 4 same-category products, never itself; `related=13` → 422 (baseline ignored it: 200); unknown → 404.
- CI (`ci.yml`) runs on `main` and PRs only; Render `autoDeployTrigger: off`.
- Push: `deploy/c2-preview` fast-forward `1ab6f7c..45da4c1`, no force. Deploy: owner, Render Manual Deploy. GitHub deployment record: `45da4c1` success 2026-10-24T08:12:14Z.
- Rollback: Render → Events → the `1ab6f7c` deploy → Rollback (or push `1ab6f7c` back as a new revert commit and Manual Deploy). Safe with every Worker: `ace736be` never sends `related`; `fae6efa2` only hides the section.

**Gate 2 (after deploy): PASS** (`backend-deploy/before.json`, `after.json`, `prod-worker-smoke.json`, `tail-summary.json`)
- Health live/ready 200. Plain product response: same keys + `related: []`; CORS `https://tunhuabinhnham.com` unchanged; `?related=4`: 4 same-category, not itself; `related=13` 422; unknown 404; products/categories/posts/settings 200; admin without token 401.
- Production site (Worker `ace736be` + new backend): SMOKE_PASS 20/20 (pages, product page with its usual 4 related cards, MISS→HIT, cookie/Authorization isolation, private routes, purge 401, 404 not cached, 308, image 24 h).
- `wrangler tail` of production during the checks (10 min, 171 events): 0 exceptions, 0 error logs, 0 5xx (outcomes: 170 ok, 1 canceled by the client).
- Not checked: an authenticated Admin session (owner); the admin API code is unchanged by `45da4c1`.

## 7. Preview E2E with the new backend (Gate 3)

Preview `fae6efa2` (`852126e`), production Worker `ace736be` untouched at 100 %.

| Check | Result |
|---|---|
| Smoke (`preview/smoke-new-backend.json`) | SMOKE_PASS 20/20: product page 4 related cards, API `related` = same category, not itself; MISS→HIT; isolation; private routes; purge 401; 404 not cached; 308; image 24 h; TTL 300 unchanged |
| SEO | server HTML of `/san-pham/tu-nhua-4-canh-4` contains the 4 related links (`/san-pham/tu-nhua-4-canh-3`, `-2`, `/san-pham/tu-4-canh-2`, `/san-pham/tu-4-canh`); canonical `https://tunhuabinhnham.com/…`; JSON-LD present |
| Navigation (`preview/nav-preview-d.json`) | prefetch 0 on Chromium, WebKit, WebKit iPhone; feedback 3–212 ms (incl. Playwright click latency); product RSC TTFB cold 1067–1113 ms, HIT 160 ms; Back/Forward 7–32 ms from the router cache |
| Cache MISS/HIT (`backend-deploy/call-count-probe-2.json`) | same URL: MISS (SIN) then HIT ×3 (SIN). Different locations cache separately (a first probe hopped HKG → SIN and missed again) |
| Light benchmark, 2 sessions, 3 products, each MISS then HIT, 2 rounds, same backend (`preview/bench-real.jsonl`) | MISS TTFB p50: **D 1.94–2.03 s vs A (production) 2.92–3.61 s**; main content p50 D 2.05–2.35 s vs A 3.28–3.69 s; 4 related cards on both. HIT p50: A 0.10–0.20 s, D 0.43–0.52 s (D's HIT pass included location-hop MISSes). This machine's network is degraded (single HITs up to 2.9 s); treat as indicative |
| Render calls per view | expected MISS 2 (`/products/{slug}?related=4`, `/site-settings`), HIT 0; measured 2 locally (`api-per-view.jsonl`). On the real stack only Render's own logs show it (`request_completed` lines with path); I have no Render access. Probe timestamps for the owner: `call-count-probe.json` (D MISS 08:14:49–53Z and 08:15:23–25Z, A MISS 08:16:25–28Z = 3 calls expected, A HIT 08:16:58Z = 0) and `call-count-probe-2.json` (D MISS 08:18:15Z, HITs 08:18:20/24/28Z = 0) |
| Product slug redirect | not exercised on live data (no known old slug in production); API and Worker code paths unchanged and covered by API tests (query kept on 301) and e2e S-tests |
| Auth isolation, image cache | PASS (smoke) |

**Gate 3 verdict: RSC_PERF_V2_PRODUCTION_READY**, with one confirmation left to the owner: Render logs at the probe timestamps show 2 API calls per uncached product render and none for HITs. Production frontend not deployed.
