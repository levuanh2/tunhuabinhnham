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
