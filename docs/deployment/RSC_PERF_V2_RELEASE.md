# RSC V2 (option D): production release runbook — P → P′ → N

Prepared 2026-10-24 (UTC). **Status: READY_FOR_PRODUCTION_APPROVAL — not deployed.** Owner confirmed the Render-log call counts (D MISS 2, A MISS 3, HIT 0) and backend `45da4c1` live (Render Deployments). Every step below needs the owner's explicit go.

Procedure: `TASK_P1_ASSET_VERSION_SKEW.md` (two-step rollout against asset version skew). Run from `E:\Tunhuabinhnham\apps\web` (holds `.deploy-assets`). Cache 12H is a separate release and is **not** part of this one.

## 1. Versions

| Role | Worker version | Code | Assets | Preview URL |
|---|---|---|---|---|
| **P** (live, 100 %) | `ace736be-c3d6-443e-a454-d7bae8c69681` | `0cfcd7d` | P + retained | — |
| **P′** | `68103970-d684-49ad-84bf-e8909278323c` (tag `rsc-v2-pprime-0cfcd7d`) | `0cfcd7d` (rebuilt clean, production env; build `u0CnMiXQm-D0EQphCHZjm`) | own 42 = archived P 42/42 (deterministic) + N `852126e` + `e681cca` (12 copied, 59 files) | https://68103970-tunhuabinhnham-web.tunhuabinhnham.workers.dev |
| **N** | `fae6efa2-4153-411c-9987-55f2f6ccfb87` (tag `rsc-v2-852126e`) | `852126e` (build `D80pnLqeOfv9mcYUjRa2D`) | own 45 + P `0cfcd7d` + `e681cca` (12 copied, 59 files) | https://fae6efa2-tunhuabinhnham-web.tunhuabinhnham.workers.dev |
| Backend (required by N) | Render `45da4c1` live since 2026-10-24 08:12Z | | | |

Both uploads: `wrangler versions upload` only. Image allowlist `fyaourksnjeldsvuedox.supabase.co`, no test hosts, bundle secret scan PASS on both. N is exactly the build tested in `RSC_PERF_V2_PREVIEW.md` §7 (no rebuild).

## 2. Pre-release evidence (`docs/qa/evidence/rsc-perf-v2/release/`)

| Check | Result |
|---|---|
| P′ serves every hashed file of P + N + `e681cca` (`verify-assets-pprime.txt`) | 54 files, 4 rounds, 0 failed, 33 s clean soak |
| N serves every hashed file of P + N + `e681cca` (`verify-assets-n.txt`) | 54 files, 0 failed, 32 s clean soak |
| P′ HTML references only P's assets (`smoke-pprime.json`) | SMOKE_PASS: every page's `_next/static` refs ⊂ `0cfcd7d`, product page 4 related (A path), MISS→HIT, isolation, private routes, purge 401, 404, 308, image 24 h |
| N HTML references only N's assets (`smoke-n.json`) | SMOKE_PASS, product page 4 related (D path) |
| Preview E2E, SEO, navigation, call counts, benchmark | `RSC_PERF_V2_PREVIEW.md` §7 + owner Render-log confirmation |

## 3. Release steps (owner go required for each)

Keep `npx wrangler tail tunhuabinhnham-web --format pretty` open in a second terminal during steps A and B (5xx, exception, 1102/1027/9523).

**Step A — P′ (no visible change; same HTML as P):**
```
npx wrangler versions deploy 68103970-d684-49ad-84bf-e8909278323c@100% --message "P-prime RSC V2: 0cfcd7d code + N 852126e assets"
npx wrangler deployments status
```

**Gate A (≥ 5 min, hard):** every edge must serve N's files before N goes live.
```
node ../../docs/qa/evidence/rsc-perf-v2/release/soak-gate.mjs https://tunhuabinhnham.com .deploy-assets/852126e --soak 300 --timeout 1800 --out ../../docs/qa/evidence/rsc-perf-v2/release/soak-pprime-production.json
```
- PASS (300 s clean): continue. ASSET FAILURE (404/MIME): stop, roll back to P (§4). UNVERIFIED only (client network): rerun; never treat as PASS.
- Production smoke on P′ (read-only): `node ../../docs/qa/evidence/rsc-perf-v2/release/preview-smoke.mjs https://tunhuabinhnham.com https://tunhuabinhnham-api.onrender.com .deploy-assets/0cfcd7d --out ../../docs/qa/evidence/rsc-perf-v2/release/smoke-pprime-production.json` → SMOKE_PASS.

**Step B — N:**
```
npx wrangler versions deploy fae6efa2-4153-411c-9987-55f2f6ccfb87@100% --message "N RSC V2 option D 852126e"
npx wrangler deployments status
```

**Gate B (after N):**
1. `soak-gate.mjs https://tunhuabinhnham.com .deploy-assets/0cfcd7d .deploy-assets/852126e --soak 300` → PASS (old tabs from P/P′ and new pages both find their files).
2. `preview-smoke.mjs https://tunhuabinhnham.com https://tunhuabinhnham-api.onrender.com .deploy-assets/852126e --out …/smoke-n-production.json` → SMOKE_PASS (product page: 4 related cards from `?related=4`, same category; MISS→HIT; isolation; private; image 24 h).
3. `nav-probe.mjs https://tunhuabinhnham.com …/nav-production-n.json chromium,webkit-mobile` → prefetch 0, feedback < 300 ms, Back/Forward from the router cache.
4. Tail 10 min: 0 exceptions, 0 5xx. Render logs: product MISS = 2 calls (`/products/{slug}`, `/site-settings`).
5. Expect a cold-cache burst on Render after each switch (cache key includes the Worker version: two cold starts, A and B).

## 4. Rollback

| Phase | Target | Command |
|---|---|---|
| Before step A | stay on P | — |
| Step A live, Gate A failing | **P** `ace736be` | `npx wrangler versions deploy ace736be-c3d6-443e-a454-d7bae8c69681@100% --yes --message "rollback to P ace736be"` |
| Step B started (N live or partially) | **P′** `68103970` — never P (P lacks N's assets for open tabs) | `npx wrangler versions deploy 68103970-d684-49ad-84bf-e8909278323c@100% --yes --message "rollback to P-prime 68103970"` |
| Backend problem | Worker to P′ first, then Render → Events → `1ab6f7c` → Rollback | P′ and P never send `related`, so they work with either backend; N with `1ab6f7c` only hides the related section |

All three versions use TTL 300, so a rollback serves at most 5-minute-old entries of the target version's own partition.

## 5. After the release

- Retention: keep `.deploy-assets/{852126e,0cfcd7d,e681cca}` (last 3 deployed builds); `1ab6f7c`, `3e8c5f0`, `70dac36` may go.
- Record versions, gate outputs and tail summary in `docs/qa/evidence/rsc-perf-v2/release/`.
- Cache 12H, if approved later, is built on top of `852126e` and released through its own P → P′ → N.

## 6. Step A executed (owner approval 2026-10-24, Step A only)

- Pre-deploy (15:3xZ): production `ace736be` 100 %, last deployment 2026-10-23T14:37Z (nothing in progress); `68103970-d684-49ad-84bf-e8909278323c` = tag `rsc-v2-pprime-0cfcd7d`; backend `45da4c1` live (GitHub deployment record, `/health/ready` 200); P′ preview re-check 54/54 assets.
- Deploy: `npx wrangler versions deploy 68103970-d684-49ad-84bf-e8909278323c@100% --yes --message "P-prime RSC V2: 0cfcd7d code + N 852126e assets"` → SUCCESS 15:34:39Z; `deployments status`: (100%) `68103970…` since 15:34:40Z. No backend, DB, env, DNS, TTL, auth or CORS change.

**Gate A: PASS** (`release/`)
| Check | Result |
|---|---|
| Traffic | 100 % `68103970` (deployments status; every tail event `scriptVersion` = `68103970`) |
| Asset soak, apex, P + N + `e681cca` (`soak-pprime-production.json`) | SOAK_PASS: 54/54 files, 0 failing, 310 s clean (15:34:5x → 15:39:58Z) |
| Production smoke ×2 (`smoke-pprime-production*.json`) | SMOKE_PASS 20/20 both: home, catalogue, category, news, about, contact 200 with only P's assets; product page 4 related (old frontend path); MISS→HIT (1277 / 86 / 86 ms); cookie/Authorization never HIT; admin, login, `/api/revalidate` private; purge without token 401; 404 not cached; 308; image 24 h WebP |
| Browser (`nav-production-pprime.json`) | Chromium + WebKit iPhone: prefetch 0; RSC MISS (cold after the switch) then HIT 60–82 ms TTFB; Back/Forward from the router cache. No pending indicator (P′ is the old code, as expected). Old tabs: P′ has P's exact HTML and assets (42/42 identical), so a P tab is unaffected |
| Tail (`tail-stepA-summary.json`, `tail-stepA-2-summary.json`) | 141 events in two windows (15:34:57–15:36:05Z, 15:41:35–15:42:08Z; the tail stream dropped after ~1 min each time on this network): outcomes all `ok`, 0 exceptions, 0 error logs, 0 5xx, 0 non-200 image transforms (no 9523), no 1102/1027 outcomes |
| Worker CPU (tail `cpuTime` = CPU time, separate from `wallTime`) | corrected per request kind, deduplicated: page/RSC n 80, CPU p50 2 ms, p95 456, max 858 (wall p50 1196, p95 2617), **35/80 above 10 ms**; image n 55, CPU p95 29 ms; admin/api n 6, CPU p95 152. Baseline `ace736be` (08:13–08:21Z): page/RSC n 64, CPU p95 630, max 831, 26/64 above 10 ms. No `exceededCpu` outcome, no 1102. Same profile as before Step A (pre-existing since Gate C3.1: uncached renders exceed the Free 10 ms figure without being cut off) |
| Backend `45da4c1` (`api-after-stepA.json`) | health 200/200; product + `?related=4` OK; lists 200; admin without token 401 |

Rollback readiness: P `ace736be-c3d6-443e-a454-d7bae8c69681` still available (Step A phase → roll back to P). **N `fae6efa2` not deployed; waiting for the owner's Step B approval.**

## 7. Step B pre-flight (owner approval 2026-10-24) — STOPPED on the CPU condition

Pre-flight, read-only: production 100 % P′ `68103970` (since 15:34:40Z); backend `45da4c1` live, `/health/ready` 200; N `fae6efa2-4153-411c-9987-55f2f6ccfb87` = tag `rsc-v2-852126e`, created 07:27:41Z (the build tested in the preview E2E; its upload message says "PREVIEW ONLY", the deploy command sets its own message); N serves 54/54 files of P + N + `e681cca`; no other deployment in progress; runbook and rollback commands unchanged.

The approval set a stop condition: "if CPU really exceeds the Free limit continuously or there is exceededCpu, stop and report BLOCKED; if it is wall time mislabelled, correct and continue". The Gate A figure **is CPU time** (`cpuTime`; `wallTime` is a separate field). Uncached page/RSC renders exceed 10 ms CPU on 44 % of observed page/RSC requests on P′ and 41 % on P (`ace736be`), up to ~0.86 s, with no `exceededCpu`/1102 in the observed windows. This is systematic for uncached renders and pre-existing, not caused by RSC V2 (N renders the same pages; it removes one API call, not render work). **Step B was not executed: BLOCKED pending the owner's decision** (accept the pre-existing Free-plan CPU risk as before, or keep P′ / plan Workers Paid).
