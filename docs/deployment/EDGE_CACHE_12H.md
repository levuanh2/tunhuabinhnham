# Cache 12H on RSC V2 — integration, preview and release plan

(This file is the path named in `apps/web/src/lib/edge-cache.ts` for emergency removal.)

Date: 2026-10-25. Branch `perf/edge-cache-12h-on-rsc-v2` from `852126e` (the source of production Worker `fae6efa2`, RSC V2 option D). Nothing pushed or deployed.

**Verdict: BLOCKED** until the owner's authenticated purge proof on the integrated preview `63e818aa` returns `AUTH_PURGE_PREVIEW_PASS` (§5) and Codex approves the final diff. Every other check below passes except the pre-existing e2e test 19 (fails on the earlier baselines too); rows marked *author-reported* rest on session output that is summarised, not committed in full.

Rationale, owner decision (public pages up to ~12 h stale to spare Render Free) and the Cloudflare Workers Cache facts are unchanged from the first Cache 12H round: `docs/qa/evidence/edge-cache-12h/old-0cfcd7d/EDGE_CACHE_12H_on_0cfcd7d.md` (that branch, `perf/edge-cache-12h`, and its preview `335c619f` are retired: not deployable).

## 1. Integration

| Commit | Content |
|---|---|
| `5d336ae` (cherry-pick of `b8e2a40`) | `EDGE_CACHE_CONTROL` `public, max-age=0, s-maxage=300` → `43200`; unit tests for HTML and RSC headers; admin purge-failure warning "trong vòng 5 phút" → "12 giờ" (product form, categories) and its e2e assertion |
| `f4fc7e1` (cherry-pick of `4da469d`) | e2e C6 (category save with a failing purge shows the 12 h warning); `rsc-replay.mjs` (real browser router requests replayed) |
| `a3a036a`, `b9122de`, later | docs, purge runner, evidence only |

Both cherry-picks applied without conflict. **App diff against production (`git diff 852126e HEAD -- apps`): 5 files, +20 / −7** — `apps/web/src/lib/edge-cache.ts` (TTL constant + comment), `edge-cache.test.ts`, `features/admin/product-form.tsx` and `app/admin/(cms)/danh-muc/page.tsx` (warning text), `e2e/catalog-admin.spec.ts` (P5 text, new C6). No RSC V2 file touched: product page / `?related=4`, navigation feedback, no-prefetch links, `worker.ts` (buffering, degraded guard, image fallback, error-response protection, credential bypass, purge RPC), slug redirect, SEO, CMS purge, Admin/Auth/private caching and the image policy (24 h) are unchanged.

## 2. Verification

| Check | Result | Evidence (`docs/qa/evidence/edge-cache-12h/`) |
|---|---|---|
| Vitest, tsc, ESLint | 13 files 63/63 (TTL HTML/RSC tests, navigation feedback ×5, product page D ×2); tsc pass; ESLint pass | `unit-lint.txt` |
| Local header matrix (QA fixture, workerd) | 38/38: every public route and query (`category`, `search`, `page`, `sort`) HTML and RSC `public, max-age=0, s-maxage=43200` + tag + router `Vary`; cookie, Authorization, admin, API, 404, old product URL (301 `no-store`), API outage (degraded), sitemap: never public | `cache-headers.json` |
| Real router requests, local | RSC_REPLAY_PASS 14/14 (non-empty `_rsc`, router headers; HTML and RSC distinct; forged variant 307) | `rsc-replay-local.json` |
| Targeted e2e (QA fixture; Chromium desktop + WebKit iPhone) | navigation-feedback N1–N3 6/6 (indicator, Back/Forward, related links in server HTML); P5 + C6 (12 h warnings) 2/2; responsive 18/20/21/22 pass, 19 fails (also failing on the earlier baselines: `docs/qa/evidence/rsc-perf-v2/e2e-summary.txt`) | `e2e-targeted.txt` |
| D related in server HTML (local fixture) | *author-reported*: `tu-5-tang` → `/san-pham/hop-dung-do`, `/san-pham/tu-ngan-keo`; committed coverage of the same: e2e N3 in `e2e-targeted.txt` | — |
| OpenNext build, production env, clean `.next` | pass, build `ZhME75JHuGk8OiJ8SAQRg`; build-log excerpts committed; allowlist / test-host / secret-scan results *author-reported* | `build-check.txt` |
| Asset compatibility (§3) | N and P′ previews each serve 57/57 hashed files, 30 s clean soak. The artifacts record only the result; the command (author-reported) was `node scripts/verify-assets-live.mjs <preview> .deploy-assets/852126e .deploy-assets/b9122de .deploy-assets/0cfcd7d .deploy-assets/e681cca --soak 30` for each preview | `preview/verify-assets-{n,pprime}.txt` |
| Preview smoke N `63e818aa` | SMOKE_PASS 20/20: public pages `s-maxage=43200` with only N's assets; product page 4 related from `?related=4` (same category, not itself); MISS→HIT (1328 / 118 / 72 ms); cookie/Authorization never HIT; admin/login/revalidate private; purge 401; 404 not cached; 308; image `public, max-age=3600, s-maxage=86400` | `preview/smoke-n.json` |
| Preview smoke P′ `c3ad4b09` | SMOKE_PASS 20/20 with `s-maxage=300` and only `852126e` assets | `preview/smoke-pprime.json` |
| Real RSC on Workers Cache (N preview) | RSC_REPLAY_PASS: RSC MISS→HIT with 43200; HTML of the same path its own entry, never the RSC payload; forged router variant 307 | `preview/rsc-replay.json` |
| SEO (N preview) | product page: 4 related links in server HTML, canonical `https://tunhuabinhnham.com/san-pham/tu-nhua-4-canh-4`, JSON-LD | `preview/seo-n.json` |
| Browser (N preview) | Chromium + WebKit iPhone: prefetch 0; indicator 43–289 ms (incl. Playwright click latency); RSC MISS cold 0.73–2.13 s; RSC HIT 65–566 ms total (most 65–75 ms; three WebKit HITs 240, 413, 566 ms on this client network); Back/Forward 15–47 ms | `preview/nav-n.json` |
| Purge (current RPC path) on N preview | **open — owner run** (§5) | `purge-probe-result.json` (after the run) |

Not re-run (unchanged by this diff, owner: no unrelated large QA): API suite, full e2e, benchmarks, Render call counts (D: MISS 2, HIT 0, owner-verified).

## 3. Versions (uploaded only; production untouched: `fae6efa2` 100 %)

| Role | Worker version | Code | TTL | Assets | Preview |
|---|---|---|---|---|---|
| **P** (live) | `fae6efa2-4153-411c-9987-55f2f6ccfb87` | `852126e` | 300 | `852126e` + `0cfcd7d` + `e681cca` | — |
| **P′** | `c3ad4b09-7d75-46d2-a085-3f7e2b40fd56` (tag `cache12h-pprime-852126e`) | `852126e` rebuilt (42/42 identical to P's own assets) | 300 | own + N `b9122de` + `0cfcd7d` + `e681cca` (62 files) | https://c3ad4b09-tunhuabinhnham-web.tunhuabinhnham.workers.dev |
| **N** | `63e818aa-c4cb-4510-85a4-b4f169515aee` (tag `cache12h-on-rsc-v2-b9122de`) | `b9122de` (app = `f4fc7e1`) | **43200** | own (3 new admin chunks vs P) + `852126e` + `0cfcd7d` + `e681cca` (62 files) | https://63e818aa-tunhuabinhnham-web.tunhuabinhnham.workers.dev |

N's own assets are archived in `apps/web/.deploy-assets/b9122de`. The old Cache 12H versions (`335c619f`, 0cfcd7d-based) must not be deployed.

## 4. Release plan (each step needs the owner's go)

Same shape as the RSC V2 release (read it with `git show origin/perf/rsc-nav-v2:docs/deployment/RSC_PERF_V2_RELEASE.md`; it is not on this branch). All commands run in **PowerShell or Git Bash from `E:\Tunhuabinhnham\apps\web`** (it holds `.deploy-assets`, `wrangler.jsonc` and `node_modules`) with branch `perf/edge-cache-12h-on-rsc-v2` checked out (for the evidence scripts). No build or upload is needed: only the uploaded versions below are deployed.

Tail (second terminal, restart when it stops; the stream drops after ~1–2 min on this network — record the covered windows; output directory `docs/qa/evidence/edge-cache-12h/release/` exists on this branch):
```
npx wrangler tail tunhuabinhnham-web --format json > ..\..\docs\qa\evidence\edge-cache-12h\release\tail-<step>-<n>.jsonl
```

**Step A — P′:**
```
npx wrangler deployments status
npx wrangler versions deploy c3ad4b09-7d75-46d2-a085-3f7e2b40fd56@100% --yes --message "P-prime Cache 12H: 852126e code + N b9122de assets"
npx wrangler deployments status
```
**Gate A (≥ 300 s):**
```
node ../../docs/qa/evidence/edge-cache-12h/soak-gate.mjs https://tunhuabinhnham.com .deploy-assets/b9122de .deploy-assets/852126e --soak 300 --timeout 1800 --out ../../docs/qa/evidence/edge-cache-12h/release/soak-pprime.json
$env:EDGE = "public, max-age=0, s-maxage=300"; node ../../docs/qa/evidence/edge-cache-12h/preview/preview-smoke.mjs https://tunhuabinhnham.com https://tunhuabinhnham-api.onrender.com .deploy-assets/852126e --out ../../docs/qa/evidence/edge-cache-12h/release/smoke-pprime.json; Remove-Item Env:EDGE
```
(Git Bash: `EDGE="public, max-age=0, s-maxage=300" node …`.) SOAK_PASS and SMOKE_PASS → continue. Failure → roll back to P:
```
npx wrangler versions deploy fae6efa2-4153-411c-9987-55f2f6ccfb87@100% --yes --message "rollback to P fae6efa2"
```

**Step B — N** (optionally a 10 % canary first: `npx wrangler versions deploy c3ad4b09-7d75-46d2-a085-3f7e2b40fd56@90% 63e818aa-c4cb-4510-85a4-b4f169515aee@10% --yes --message "Canary Cache 12H"`, version-pinned checks with `$env:VERSION_OVERRIDE = "63e818aa-c4cb-4510-85a4-b4f169515aee"` for `preview-smoke.mjs` and `nav-probe.mjs`):
```
npx wrangler versions deploy 63e818aa-c4cb-4510-85a4-b4f169515aee@100% --yes --message "N Cache 12H on RSC V2 b9122de"
npx wrangler deployments status
```
**Gate B:**
```
node ../../docs/qa/evidence/edge-cache-12h/soak-gate.mjs https://tunhuabinhnham.com .deploy-assets/852126e .deploy-assets/b9122de --soak 300 --timeout 1800 --out ../../docs/qa/evidence/edge-cache-12h/release/soak-n.json
node ../../docs/qa/evidence/edge-cache-12h/preview/preview-smoke.mjs https://tunhuabinhnham.com https://tunhuabinhnham-api.onrender.com .deploy-assets/b9122de --out ../../docs/qa/evidence/edge-cache-12h/release/smoke-n.json
node ../../docs/qa/evidence/edge-cache-12h/rsc-replay.mjs https://tunhuabinhnham.com ../../docs/qa/evidence/edge-cache-12h/release/rsc-replay-n.json
node ../../docs/qa/evidence/rsc-perf-v2/nav-probe.mjs https://tunhuabinhnham.com ../../docs/qa/evidence/edge-cache-12h/release/nav-n.json chromium,webkit-mobile
```
SOAK_PASS, SMOKE_PASS (TTL 43200), RSC_REPLAY_PASS, prefetch 0 + indicator; tail: 0 exceptions / 5xx / `exceededCpu` / 1102 / 1027 / 9523.

**Production purge proof (release gate, owner):** warm a page twice (`https://tunhuabinhnham.com/san-pham?gate=<random>`, second response HIT with an `Age`), then in the production Admin save one harmless item (e.g. Cài đặt unchanged) → no warning; fetch the warmed URL again from the same network and from a second network: it must be young (MISS, or HIT with `Age` < seconds since the save) at a `cf-ray` location that served the HIT before. **Fail → roll back to P′ immediately** (below).

## 5. Purge proof on the integrated preview (owner, before any release)

Run in your own PowerShell (not through an AI tool, never paste the password into a chat):
```
cd E:\Tunhuabinhnham
git branch --show-current     # perf/edge-cache-12h-on-rsc-v2
powershell -ExecutionPolicy Bypass -File docs\qa\evidence\edge-cache-12h\run-purge-probe.ps1
```
Admin e-mail, then the password (hidden). ~3–6 min. The runner (reviewed runner v3; preview-origin guard; pinned Supabase origin) warms the preview `63e818aa` image + page and a production page (`fae6efa2`, TTL 300), checks that token-less and invalid-token purges are refused and evict nothing, logs in, purges **the preview only**, requires the preview entries to be purged and production untouched (Age + location rules; a MISS at a location that never held the entry proves nothing), logs out (revoked token refused) and writes `docs/qa/evidence/edge-cache-12h/purge-probe-result.json` without credentials. `AUTH_PURGE_PREVIEW_PASS` → tell me. `INCONCLUSIVE` → rerun from another network (phone hotspot / VPN off). `FAIL` → stop.

## 6. Rollback and emergency removal

- **N → P′** (from `E:\Tunhuabinhnham\apps\web`):
  ```
  npx wrangler versions deploy c3ad4b09-7d75-46d2-a085-3f7e2b40fd56@100% --yes --message "rollback to P-prime c3ad4b09"
  ```
  Never straight to P `fae6efa2-4153-411c-9987-55f2f6ccfb87` once N has started (P lacks N's 3 new admin chunks for open tabs). P′ is a new version that only ever serves with TTL 300, so its partition holds entries ≤ 5 min old.
- **A rollback does not delete N's 12 h entries**: they stay in N's partition (the cache is partitioned per Worker version; `cross_version_cache` is off) until they expire, unused while N is not deployed. Never re-deploy N `63e818aa-c4cb-4510-85a4-b4f169515aee` (or any version that served 12 h) after it has been replaced: upload a new version instead; if it must be re-deployed, make an admin save right after the switch (the purge then runs in that version's own `PublicCache`) and verify at two `cf-ray` locations.
- **Emergency removal while N is live:** (1) admin save (purges tag `public-html` for the live version); (2) on a cache warning ("… trong vòng 12 giờ" / "chưa thể làm mới cache công khai"), wait ≥ 1 min without other saves (Workers Cache uses Free-tier purge limits: 5 tag purges/min per account, bucket 25) and save once more; (3) still failing → upload and deploy a **new** version of the current source (empty partition; expect a Render MISS burst). From `E:\Tunhuabinhnham\apps\web` on this branch, with no `NEXT_PUBLIC_*` variables set in the shell (the build reads `.env.production.local`):
  ```
  # PowerShell: Remove-Item -Recurse -Force .next, .open-next -ErrorAction SilentlyContinue
  # Git Bash:   rm -rf .next .open-next
  npm run build:cloudflare
  node scripts/merge-previous-assets.mjs .open-next/assets .deploy-assets/b9122de .deploy-assets/852126e .deploy-assets/0cfcd7d
  npx wrangler versions upload --message "emergency cache reset (Cache 12H)"
  npx wrangler versions deploy <Worker Version ID printed by the upload>@100% --yes --message "emergency cache reset"
  ``` (4) verify absence at two distinct `cf-ray` locations and record them. Zone-level purge (dashboard/API) does **not** affect Workers Cache.
- Backend stays `45da4c1` throughout (not involved).

## 7. Remaining risks

1. Purge on the current RPC path is proven only after the owner's preview run (§5) and the production gate (§4.4); until then the 12 h TTL is unproven against removal.
2. A failed purge keeps hidden/old content public up to 12 h (owner-accepted staleness, emergency path §6).
3. Workers Free CPU: on RSC V2 production (N `fae6efa2`, 2026-10-24) uncached page renders used CPU p50 47 / p95 390 / max 390 ms, 20/20 above 10 ms (`rsc-v2-production-cpu.json`, copied from the RSC V2 release evidence); pre-existing and owner-accepted. Not measured for this branch (same render code); a 12 h TTL means fewer renders.
4. Each version switch starts a cold cache (two cold starts per release; Render MISS burst).
5. Pre-existing P3: a forged router-state request evicts one cached RSC entry (re-render on the next request); no data exposure.
6. The 10 % canary splits per request: a visitor can get a full-page fallback when consecutive requests land on different builds.
