# RSC navigation performance V2: release gate

Date: 2026-10-24. Branch `perf/rsc-nav-v2` (from `e3d5d4b`, app code = production `0cfcd7d`). Nothing pushed or deployed. Evidence: `docs/qa/evidence/rsc-perf-v2/`.

**Verdict: RSC_PERF_V2_READY_FOR_PREVIEW.** Codex round 2: APPROVE, no P0–P3 open (round 1: one P2 in this report, fixed; one P3 accepted, §9). Benchmarks and full regression done. Deploy still needs owner approval per step (§8).

Commits: `bf346ed` + `75f8554` navigation feedback (unchanged from the first round), `9448d43` API `GET /products/{slug}?related=n`, `7a14908` product page uses it. The first round's option B (`related_to` + parallel calls) is kept only on `archive/rsc-nav-v2-option-b` (`23b4d12`): it failed the owner's "other routes" condition (§2).

## 1. Root cause (measured, unchanged)

| Finding | Evidence |
|---|---|
| RSC is not streamed: TTFB ≈ total | `worker.ts` `fetchPublic` buffers the body so a degraded render (API failure) is never edge-cached. `loading.tsx` cannot show early either: there is none, and with `prefetch={false}` + buffering the router has nothing to show before the response. Hence the browser-side pending indicator. |
| Cold (MISS) navigation = slowest backend call + render | production RSC 1.5–3.3 s cold; API from Render 0.7–1.7 s per call |
| Warm (edge HIT) is already fast | production RSC 60–95 ms, content 114–453 ms |
| Product page waterfall | product → `category=` list: two sequential calls, three Render calls per MISS view with settings |

## 2. "Sản phẩm cùng loại": options compared

| | A today | B `related_to`, 3 calls in parallel | C browser fetch near viewport | **D related in the product response** |
|---|---|---|---|---|
| Render calls per product view, MISS | 3 | 3 | 2 server + 1 browser | **2** |
| … per view, edge HIT | 0 | 0 | **+1 per view that scrolls** | 0 |
| DB statements per MISS view (SQLite count; + 1 pre-ping per request on Postgres) | 3+4+1 | 3+4+1 | 3+1 (+4 browser) | **3+1** |
| Render calls, unknown slug / old slug (301 followed) | 2 / 3 | 3 / 4 (`related_to` wasted) | 2 / 3 | 2 / 3 (no saving; Codex P2) |
| related links in server HTML (SEO) | yes | yes | no | yes |
| edge cache key, tag, purge | unchanged | unchanged | page purged, related keeps the API's 60 s browser cache | unchanged |
| new Worker + old backend | — | wrong products (newest of all categories) | — | section hidden (`related` absent) |

### Method

Local Worker (workerd, no edge cache: every view is a MISS render) + `mock-api.mjs` replaying the production snapshot offline (never calls production), service times measured on Render 2026-10-23 (product 700 ms, list 1000 ms, posts 850, others 470), and **4 concurrent requests** as configured in `render.yaml` (1 uvicorn worker, `DB_POOL_SIZE=3` + `DB_MAX_OVERFLOW=1`). D's 800 ms is modelled, not measured: same statements as the product alone (asserted by `test_product_with_related_in_one_response`) plus serialising 4 more products (~9 ms each from the list endpoint); 1000 ms (as slow as a list call) was also run. **All numbers are estimates of relative behaviour under these assumptions, not production measurements**; the real Render capacity (0.1 CPU, GIL) may be lower than 4, hence the sensitivity runs. Times are RSC response arrival (= content, minus browser paint). Each row is the mean of 2 runs.

- `load-mix.mjs` closed loop: S sessions alternate a product page and another route (7 routes), seeded think time 0.5–2 s, 8 rounds.
- `load-mix.mjs` RATE: open loop, the same seeded arrivals for every option (views/s), 60 s. This is the fair "other visitors at the same traffic" comparison: in the closed loop a faster option generates more traffic.
- `api-per-view.mjs`: calls per route, one view at a time.

### Product page and other routes, p50 / p95 (ms)

Closed loop (`load-mix.jsonl`):

| sessions | | A | B | C | D |
|---|---|---|---|---|---|
| 1 | product main | 1966 / 2282 | 1101 / 1337 | 767 / 805 | 902 / 929 |
| | product full (related shown) | 1966 / 2282 | 1101 / 1337 | 1781 / 1814 | 902 / 929 |
| | other routes | 1097 / 1316 | 1089 / 1128 | 1090 / 1113 | 1088 / 1105 |
| 5 | product main | 2151 / 3051 | 1565 / 2580 | 922 / 1797 | 953 / 1740 |
| | product full | 2151 / 3051 | 1565 / 2580 | 2188 / 2994 | 953 / 1740 |
| | other routes | 1101 / 1663 | 1198 / **2081** | 1116 / 1583 | 1090 / 1625 |
| 10 | product main | 4780 / 5612 | 3647 / 4645 | 2279 / 2962 | 2346 / 3281 |
| | product full | 4780 / 5612 | 3647 / 4645 | 4740 / 5543 | 2346 / 3281 |
| | other routes | 2322 / 3217 | 3471 / **4458** | 2347 / 3206 | 2499 / 3325* |

\* D finishes the same 160 views in 61 s instead of 79 s (29 % more requests per second in a closed loop); at equal traffic (below) D is the best for other routes.

Open loop, same arrivals for every option (`load-open.jsonl`):

| rate | | A | B | C | D |
|---|---|---|---|---|---|
| 0.8 view/s | product main / full p95 | 2640 / 2640 | 2021 / 2021 | 1559 / 2633 | 1839 / 1839 |
| | other p50 / p95 | 1076 / 1781 | 1081 / 1833 | 1076 / 1774 | 1132 / **1526** |
| 1.4 view/s | product main / full p95 | 4394 / 4394 | 2771 / 2771 | 2155 / 4063 | 1881 / 1881 |
| | other p50 / p95 | 1470 / 2425 | 1366 / 2546 | 1363 / 2270 | 1078 / **1816** |
| 1.8 view/s | product main / full p95 | 8642 / 8642 | 5767 / 5767 | 4431 / 8575 | 2272 / 2272 |
| | other p50 / p95 | 1720 / 4206 | 1944 / **5362** | 1759 / 4198 | 1089 / **2104** |

### Backend load

| | A | B | C | D |
|---|---|---|---|---|
| Render calls per view (mixed routes) | 2.79 | 2.79 | 2.79 | **2.29** |
| backend busy time, 1.8 view/s, 60 s | 216 s | 216 s | 216 s | **165 s (−24 %)** |
| peak requests at Render (served + queued), 1.8 view/s | 30 | **35** | 30 | **15** |
| queue wait p50 / p95, 1.8 view/s | 785 / 3512 | 1064 / 4400 | 799 / 3493 | **220 / 1271** |
| peak, closed loop 10 sessions | 21 | **30** | 22 | 22 |

### Sensitivity (`load-sensitivity.jsonl`, open loop, 1 run each)

| assumption | other routes p95: A / B / D | product full p95: A / B / D |
|---|---|---|
| Render serves 2 at once, 0.8 view/s | 6105 / 7195 / **3432** | 10411 / 7761 / **3454** |
| Render serves 8 at once, 1.8 view/s | 1174 / 1414 / 1154 | 2116 / 1418 / 1154 |
| Render serves 8 at once, 3.0 view/s | 1898 / 2061 / **1374** | 3285 / 2206 / **1312** |
| D takes 1000 ms (as a list call), 4 at once, 1.4 / 1.8 view/s | D: 1992 / 2659–2710 (A: 2425 / 4206) | D: 2132 / 3091–3146 |

The order holds under every tested assumption: B always makes the other routes slower than A; D is never worse than A for other routes beyond noise and is much better for the product page. The first D=1000 run had 5 and 3 degraded renders (a fetch from the Worker to the mock failed; local workerd logged "dropped connection to the UserWorker"); none in two reruns; they were correctly marked not cacheable.

### Worker CPU (render time with an instant API, `load-render.jsonl`, 15 views each, p50 / p95 ms)

| | A | B | C | D |
|---|---|---|---|---|
| product | 98 / 156 | 82 / 88 | 68 / 112 (no related cards) | 79 / 117 |
| other routes | 82 / 85 | 83 / 129 | 82 / 85 | 83 / 99 |

Local wall time (includes loopback fetches), not billed CPU; no measurable difference between A, B and D.

### Owner's conditions for B

| condition | B | D |
|---|---|---|
| no extra API calls on cache HIT | pass | pass |
| no extra calls per MISS without proven benefit | pass (3) | pass (2, fewer) |
| other routes' p95 not significantly worse at 5–10 sessions | **fail**: +25 % (5), +39 % (10); +27 % at 1.8 view/s | pass: −14 % to −50 % at equal traffic |
| image cache, auth isolation, purge, SEO, slug redirect intact | pass | pass |
| no cost | pass | pass |

**Chosen: D.** B is not kept (archive branch only). C rejected (owner: browser calls on cached views, SEO). Suspense streaming not implemented: cache headers are chosen before the first byte, so a streamed page whose deferred part fails would be edge-cached for 300 s; the degraded-render guard needs whole-page buffering.

## 3. Changes

| Commit | Change |
|---|---|
| `bf346ed`, `75f8554` | `components/navigation-feedback.tsx`: for client navigations next/link handled, the clicked link dims and `<main>` gets `aria-busy` at once; a top bar appears after 150 ms (CSS delay; reduced motion keeps it static). Set on the DOM in the click handler (React state beside Next's transition was dropped in WebKit); cleared when the new URL commits, on Back/Forward, on a click back to the current page, or after 20 s. ESLint ignores the git-ignored `.deploy-assets`. |
| `9448d43` (API) | `GET /products/{slug}?related=n` (0–12, default 0): adds `related`, up to n public products of the product's category (any category if none), newest first, itself excluded. One statement with the product ordered first (`ORDER BY slug = :slug DESC`), so the same statements as the product alone (test asserts it). Without the parameter the response only gains `related: []`. Unknown/draft/hidden → 404, old slug → 301 with the query kept (existing code paths). |
| `7a14908` | Product page calls `/products/{slug}?related=4` (generateMetadata and the page share the URL, so one fetch) with settings in parallel, renders `product.related ?? []`. The e2e fixture mirrors `related`. |

No change to `worker.ts`, cache headers, cache keys, purge, `next.config.ts`, OpenNext config, prefetch, Admin, auth, slug redirect or rate limit.

## 4. Navigation feedback and route timings (first round, code unchanged since)

| | before (local cold) | after (local cold) | production today (warm/HIT) |
|---|---|---|---|
| click → first feedback p50 / p95 | 1,231 / 2,199 ms (= the new page) | 149 / 266 ms (incl. Playwright click latency; in-page 8–10 ms) | 114–453 ms (= the new page) |
| prefetch / RSC per click | 0 / 1 | 0 / 1 | 0 / 1 |

Warm navigation p50 ≤ 800 ms is met today (edge HIT). Cold p95 ≤ 1.5 s is not reachable on this infrastructure (one Render call is 0.7–1.7 s).

## 5. QA

| Check | Result |
|---|---|
| Vitest | 13 files, 63/63 (product page ×2 fail-before: "no second request", "old backend without `related`"; navigation feedback ×5) |
| TypeScript, ESLint | pass |
| API pytest (not integration) | 133 pass; `test_product_with_related_in_one_response` fail-before confirmed; 5 admin tests fail identically on the baseline (503, pre-existing) |
| ruff, **mypy** | pass; mypy run in an isolated `uv` environment (not installed globally): no issues in 21 files |
| PostgreSQL SQL | compiled and read: the inner `products` of the derived table is not correlated to the outer one; `ORDER BY products.slug = '…' DESC` puts the product first |
| e2e, Chromium desktop + WebKit iPhone (QA fixture, local workerd) | 74 pass / 17 fail. 11 = the pre-existing list (`e2e-summary.txt`). 6 order-dependent: G1, G3, P4, P5, P6, S4 — each passes when its spec runs alone; with the same order (catalog-admin → gallery) the **option B build fails the same way** (G1, P4, C1 in 2/2 runs): a product page shows the previous image set after the fixture is changed directly. Not caused by D; root cause not found (open item). |
| e2e, WebKit desktop | 45 pass / 15 fail: 10 pre-existing (same as the first round's baseline list) + order-dependent C1, C3, G1, S4, A6 (A6 is news/banner admin, untouched here) |
| N3 (related links in server HTML, same category, not itself) | pass |
| Cache isolation, image MISS/HIT, purge, slug 301, rate limit, CORS/CSP/HSTS | code paths unchanged; production checks after deploy |

## 6. Cost

- Render: −1 call per uncached view of a valid product URL (3 → 2); unknown slugs (2) and old slugs (3: product, followed 301, settings) cost the same as today (not benchmarked). ~24 % less backend busy time at equal traffic in the model. Supabase: per valid product view 4 application statements instead of 8 (+1 pre-ping per request).
- Workers: same requests, same render work. No new service, cache tier, R2/KV, ISR or plan change.

## 7. Codex review

Round 1 (2026-10-24, `codex-review-r1.txt`): REQUEST_CHANGES, no P0/P1. P2: this report claimed savings for unknown/old slugs that do not exist (fixed in §2 and §6). P3: no indicator on a slow Back/Forward (accepted, §9). Confirmed: PostgreSQL statement and correlation, public rules on target and related rows, no enumeration, `related` bounds, degraded guard on the combined call, fetch dedupe, no unhandled rejection, cache keys/purge/credentials unchanged, rollout order. Request: `docs/qa/evidence/rsc-perf-v2/CODEX_REVIEW_REQUEST.md`. To run: `codex exec --sandbox read-only -C /e/Tunhuabinhnham "$(cat docs/qa/evidence/rsc-perf-v2/CODEX_REVIEW_REQUEST.md)"`. Round 2 (`codex-review-r2.txt`, on `dad8c90`): **APPROVE**, no remaining P0–P3; P2 resolved, P3 accurately recorded.

## 8. Rollout (each step needs owner approval)

1. **Backend first.** Cherry-pick `9448d43` onto `deploy/c2-preview` (`1ab6f7c`; `apps/api` there equals this branch's base), API suite, push, Render Manual Deploy. Old Worker + new backend: unaffected (only an empty `related` field).
2. Verify read-only: `curl ".../api/v1/products/<slug>?related=4"` → same-category public products, not itself; plain `/products/<slug>` unchanged + `related: []`; unknown → 404; old slug → 301 with `?related=4`. Measure `?related=4` vs plain time on Render (validates the 800 ms model).
3. **Worker** via P → P′ → N (`TASK_P1_ASSET_VERSION_SKEW.md`), clean `.next`, production env, image allowlist check. New Worker + old backend only hides the section (no wrong data), but keep the order.
4. Production checks: soak, `n-smoke.mjs`, `image-cache-probe.mjs`, browser smoke (0 prefetch), `nav-probe.mjs` vs `prod-before.json`, tail for 5xx/1102/1027/9523, Render request counts per product view.

Rollback: Worker → its P′; backend → Render deploy of `1ab6f7c` (roll the Worker back first, otherwise the related section disappears until then).

## 9. Remaining risks

1. Benchmarks are a model (mock service times, 4-connection Render); confirm with production numbers after deploy (step 2 and 4).
2. Cold navigations stay bound by Render latency; no streaming while the degraded-render guard needs buffering.
3. Order-dependent e2e flakes (G1/G3/P4/P5/P6/S4/C1) exist on the option B build too; to investigate separately.
4. `site-settings` is fetched on every uncached render; a shared cache would need its own invalidation (not added).
5. The 20 s cap can hide the bar for a navigation that really takes longer.
6. Codex P3 (accepted, not fixed): a Back/Forward that misses Next's router cache and waits on an uncached RSC response shows no indicator (popstate only clears it). Usually served from the router cache (16–67 ms measured).
