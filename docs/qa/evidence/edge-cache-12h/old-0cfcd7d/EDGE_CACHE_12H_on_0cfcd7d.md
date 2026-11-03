# Public edge cache: 12 hours

Date: 2026-10-24. Branch `perf/edge-cache-12h` from `0cfcd7d` (the production source of Worker `ace736be`). Separate from RSC Performance V2 (`perf/rsc-nav-v2`): no file in common, can be reviewed, released and rolled back alone. Nothing pushed or deployed.

**Verdict: see §6** (not yet proposed for deploy: Codex round 7 APPROVE; the owner's authenticated purge proof on the preview (§5) is still open).

## 1. Decision

The owner accepts public pages up to about 12 hours stale to take load off Render Free (owner request 2026-10-24). Only the edge lifetime of responses that are **already** eligible for the shared cache changes:

| | before | after |
|---|---|---|
| public HTML and signed RSC (home, `/san-pham` incl. category/search/page/sort queries, product detail, `/tin-tuc`, post detail, `/gioi-thieu`, `/lien-he`) | `public, max-age=0, s-maxage=300` | `public, max-age=0, s-maxage=43200` |
| browsers | revalidate every time (`max-age=0`) | unchanged |
| transformed images `/_next/image` (WebP) | `public, max-age=3600, s-maxage=86400` | unchanged |
| admin, auth, `/api/*`, logout, middleware redirects, 404, old-URL 301, degraded renders, `Set-Cookie`, requests with session cookie or `Authorization`, sitemap/robots | private / no-store / not stored | unchanged |

Unchanged on purpose: the eligibility rules (`isEdgeCacheableRequest`, `edgeCacheHeaders`), the cache key (path + query + Worker version), `Vary` on the router headers, the `_rsc` signature rule (HTML and RSC are different keys), the `public-html` purge on every admin save, the degraded-render guard and the whole-body buffering in `worker.ts`, slug redirects, SEO, image policy, contact-click tracking and rate limiting (Render API, never cached by the Worker).

## 2. Change (`b8e2a40`)

| File | Change |
|---|---|
| `apps/web/src/lib/edge-cache.ts` | `EDGE_CACHE_CONTROL` `s-maxage=300` → `43200`; comment states the owner decision and points here |
| `apps/web/src/lib/edge-cache.test.ts` | HTML and RSC headers asserted equal to `public, max-age=0, s-maxage=43200` (fail-before: both failed on 300) |
| `apps/web/src/features/admin/product-form.tsx`, `apps/web/src/app/admin/(cms)/danh-muc/page.tsx`, `apps/web/e2e/catalog-admin.spec.ts` | the warning shown when a save succeeded but the purge failed said "trong vòng 5 phút"; now "trong vòng 12 giờ" (it is the TTL backstop) |

## 3. What a 12 h TTL means

**Which cache this is** (code, not assumptions): `wrangler.jsonc` enables Cloudflare **Workers Cache** on the `PublicCache` entrypoint only (`exports.PublicCache.cache.enabled: true`; the default gateway entrypoint has it off). Responses are stored there according to their `Cache-Control`/`Cache-Tag`; the purge is `ctx.cache.purge({ tags: ["public-html"] })` called by `PublicCache.purge()` (`edge-cache.ts` `purgeEdgeCache`, RPC from the gateway after `/api/revalidate`). The code does **not** use the Cache API (`caches.default`) and does not rely on the zone cache. Cloudflare documentation (Workers → Cache → Purge, Limitations, retrieved 2026-10-24):
- the cache is keyed by request path (+ query), entrypoint and, by default, **Worker version** ("partitions the cache by Worker version"; `cross_version_cache` is not enabled here); it is tiered (each data centre's lower tier, then an upper tier);
- `ctx.cache.purge()` is scoped to the Worker and to **the entrypoint that calls it** (here `PublicCache`, the only cached entrypoint) and "propagate[s] globally"; the documentation does **not** say whether a purge run by one version also clears entries written by other versions;
- "no zone-level purge (via the dashboard, API, or Terraform) affects Workers Caching content", and there is no Workers-Cache purge from outside the Worker: purging happens only through the Worker's own code (an admin save) or by switching to a version with an empty partition;
- Workers Cache always uses the **Free-tier purge limits**: tag purges 5 requests per minute per account, bucket 25, 100 tags per request (Cache → Purge cache → Availability and limits).

- **Normal edits**: every admin save calls `/api/revalidate`, which purges tag `public-html` (all cached pages, RSC and images). The next visitor gets a fresh render. Nothing waits for 12 h.
- **A purge that fails** (Free-tier purge rate limit, Cloudflare error): the admin sees "Đã lưu. Trang web công khai sẽ tự cập nhật trong vòng 12 giờ". Until the next successful purge or expiry, a hidden/unpublished product, a deleted post, an old price or an old product URL (200 instead of 301) can stay visible for up to 12 h (was 5 min).
- **Per data centre**: each Cloudflare location keeps its own copy, so the first visitor through a location still renders (MISS); entries can be evicted earlier than 12 h. 12 h is a maximum, not a guaranteed hit lifetime.
- **Render load**: a page costs Render calls only on a MISS. With 300 s a page re-rendered at most every 5 min per location while visited; with 43200 s, by expiry, every 12 h unless purged; purges, deploys, cache eviction and forged router variants (below) cause extra renders.
- **API failure**: unchanged; a render with any failed API call is `private, no-store` and never stored, the previous good copy stays until it expires or is purged.
- **Deploy/rollback**: the cache key includes the Worker version. A **newly uploaded** version starts empty (MISS spike on Render after each deploy, as today). Switching back to an **existing** version reuses whatever that version still has cached: up to 12 h old if it ever served with this TTL (Codex P1).
- **Forged router variant** (found on the preview, pre-existing, not changed by the TTL): a request with a valid `_rsc` URL but other router headers gets Next's 307 and evicts that URL's cached RSC entry, which legitimate visitors share. In the probe (`preview/evict-probe.txt`) the next two legitimate requests were MISS (re-rendered) and the entry was a HIT again 5 s later, so one forged request cost at least two extra renders there; no bound is claimed. Comparable in origin load to requesting uncached query strings, but it also evicts a shared entry. P3: pre-existing, no data exposure.

Purge evidence (not re-claimed here): Gate C3.1 (2026-10-13) proved in production that a purge removed a cached HTML page (`GATE_C3_1_FREE_OPTIMIZATION.md`, 05:28–05:29 timeline). Since V1.1 (`e681cca`) the purge runs through the `PublicCache` RPC; production evidence for that path is `/api/revalidate` returning 200 on admin saves (`PRODUCT_UX_ROLLOUT_PLAN.md`), which means the purge call did not fail, **not** a measured MISS after purge. That check is part of the post-deploy test (§5).

## 4. Emergency removal (content must disappear now)

In order; stop at the first that works. Removal is complete only when step 4 passes.

1. **Save in Admin.** Hide/unpublish/delete the item (or open Cài đặt and save without changes). Every successful save purges tag `public-html` (all public pages, RSC and images). No warning = the purge call succeeded.
2. **If the save shows a cache warning** ("… tự cập nhật trong vòng 12 giờ" or "Nội dung đã lưu nhưng chưa thể làm mới cache công khai"), the purge failed. The Worker does not report why (`worker.ts` returns a generic 502): a purge rate limit (Free tier: 5 tag purges per minute per account, bucket 25 — a burst of admin saves, e.g. reordering many categories, can exhaust it) or another Cloudflare error. Wait at least one minute without other admin saves, then save once more. If that also warns, go to step 3.
3. **Deploy a newly uploaded Worker version** (not an existing one): rebuild the *current* source, `wrangler versions upload`, then deploy that new version. A new version's partition is empty (documented per-version partitioning; observed in production on 2026-10-13, `PRODUCT_GALLERY_FIX.md`: no HTML of the previous version was served after the switch). Use the normal P → P′ → N procedure when there is time; in a real emergency deploy the new version directly and accept the MISS burst on Render. **Never** switch back to an existing older version for this: its partition may still hold entries up to 12 h old, and it is not documented that a purge by the current version clears them.
4. **Verify from distinct Cloudflare locations.** Cloudflare caches per location, and a purge or version switch is only proven where it was observed. Fetch the page anonymously (`curl -sI` and `curl -s`, no cookies) from at least two places whose responses carry **different location codes** in the `cf-ray` header suffix (e.g. `-SIN` vs `-HKG`; two networks can reach the same location, so check the code, not the network), for example your own connection plus a phone on mobile data, a VPN exit or an online multi-location HTTP checker. At every location the removed content must be absent from the body (for a page that should disappear: 404 or the updated page). After a version switch, also confirm `npx wrangler deployments status` shows the new version at 100 %. The asset gate (`verify-assets-live`) does **not** prove this: it does not identify the Worker version, and a rebuild of the same source has the same assets. Content absent at every checked location is the completion criterion; record the `cf-ray` codes.
5. Cloudflare dashboard / API "Purge Cache" for the zone: documented to have **no effect** on Workers Cache. Do not use it for this.

After any emergency, record what was removed, how, and when step 4 passed in `docs/deployment/`, and check Render logs for the MISS burst.

## 5. Tests

Local (workerd + QA fixture) proves the headers each response leaves the Worker with; local workerd has no Workers Cache. The real cache (MISS → HIT, TTL, HTML/RSC separation) was checked on a **preview version** (`335c619f`, uploaded only, never deployed; it reads the production API). Purge on the current RPC path needs an Admin session, whose saves write production data: owner step, after deploy.

**Purge proof before production (owner step, no content written).** The Admin UI cannot run on a preview URL (the production API's CORS refuses the `workers.dev` origin: preflight 400). The proof reuses the purge runner v3 of the perf hotfix (`docs/qa/evidence/perf-hotfix/purge/`, three Codex rounds; same logic, only the preview origin and labels changed, plus a guard that the token is only ever sent to a `*-tunhuabinhnham-web.tunhuabinhnham.workers.dev` preview): `docs/qa/evidence/edge-cache-12h/run-purge-probe.ps1` → `purge-probe.mjs`.
- The wrapper asks for the Admin e-mail and the password (hidden, `Read-Host -AsSecureString`), passes them to the runner through the process environment only and clears them afterwards. The runner logs in to Supabase Auth, never prints or writes the token, calls only the preview's `/api/revalidate`, logs out (session revoked; a revoked token is refused with 401) and writes `purge-probe-result.json` without credentials.
- Gates: token-less and invalid-token purges refused and evict nothing; authenticated purge 200; preview image and page **purged** and production page **untouched**, judged by `Age` + `cf-ray` location (an old HIT after the purge is FAIL; a fresh response at a location that served a HIT before is PASS; otherwise INCONCLUSIVE — a MISS at a location that never had the entry proves nothing).
- 2026-10-23 run on the perf-hotfix preview: everything PASS except "preview page purged" INCONCLUSIVE (the client drifted SIN → HKG). An INCONCLUSIVE run is not a PASS: rerun from a stable network path (e.g. VPN off, or a phone hotspot).
- Control done here (invalid token, `335c619f`): 401, entry still HIT.

Post-deploy checks (release gates; owner approval for the deploy):
1. `curl -sI https://<host>/san-pham?gate=<random>` twice: MISS then HIT; `cache-control: public, max-age=0, s-maxage=43200`.
2. Render log: no request for a page served as HIT.
3. Admin save (any harmless field) → no warning → a page cached before the save is a MISS with the new content at two distinct `cf-ray` locations (**purge proof for the current RPC path**). If this fails: roll back (§7) and treat purge as broken.
4. Logged-in admin pages and `/api/*` stay `private, no-store`; a request with an `sb-*-auth-token` cookie is never a HIT.
5. Images stay `public, max-age=3600, s-maxage=86400`.

## 6. Results and verdict

Evidence: `docs/qa/evidence/edge-cache-12h/` (`unit-lint.txt`, `cache-headers.json`, `rsc-replay-local.json`, `e2e-*.txt`, `preview/`).

| Test | Result |
|---|---|
| Unit (Vitest) | 11 files, 56/56; HTML and RSC header tests fail-before on 300, pass on 43200; image tests still 86400 (`unit-lint.txt`) |
| TypeScript, ESLint | pass (ESLint run with `--ignore-pattern ".deploy-assets/**"`: the git-ignored build archives in `apps/web/.deploy-assets` are not source; RSC V2 adds that ignore to the config) |
| Local header matrix (`cache-headers.mjs` → `cache-headers.json`) | 38/38 headers for HTML and RSC of every public route and query (`category`, `search`, `page`, `category&sort`), credentials, admin, API, 404s, old product URL (301 `no-store`), API outage (degraded `private, no-store`), sitemap (Next's own header, no s-maxage). Its RSC rows use Next's empty `_rsc` redirect target, so they prove the header, not a real router request (Codex P2) — see the next two rows |
| Real router requests, local (`rsc-replay.mjs` → `rsc-replay-local.json`) | 14/14: captured from a browser (non-empty `_rsc`, `rsc` + `next-router-state-tree` + `next-url`); replay → `text/x-component`, 43200, `Vary` with the router headers; HTML of the same path → HTML, 43200; the RSC URL without router headers → `private`; with another router state → 307 `private` |
| Real router requests on Workers Cache (preview `335c619f`, `preview/rsc-replay.json`) | 14/14: RSC MISS → HIT with 43200; the HTML of the same path is its own entry (MISS, HTML), never the RSC payload; forged variant 307 BYPASS. `preview/evict-probe.txt`: the HTML request does not disturb the RSC entry; a forged variant evicts it: the next two legitimate requests were MISS, HIT again after 5 s; no bound claimed (§3) |
| Preview smoke (`preview/preview-smoke.mjs` → `preview/smoke.json`) | 19/19 SMOKE_PASS: public pages 43200, assets from this build, security headers; anonymous HTML MISS → HIT → HIT (1687 / 422 / 146 ms); cookie and Authorization never HIT, `private, no-store`; `/admin`, login, `/api/revalidate` private; token-less purge 401; unknown product 404 not cached; 308 kept; image 24 h WebP. Author-reported, not in `smoke.json` (overwritten by the rerun): the first run showed a degraded `/tin-tuc` render (API error) served `private, no-store`, i.e. not stored, as designed |
| e2e cache policy (`responsive.spec.ts` 18, 20, 21, 22) | 18, 20, 21, 22 pass; 19 fails (`e2e-cache-policy.txt`). Author-reported, not in this evidence directory: 19 also fails on the earlier baselines (list in `docs/qa/evidence/rsc-perf-v2/e2e-summary.txt` on `perf/rsc-nav-v2`) |
| e2e purge-failure warnings | P5 (product form) and new C6 (category save with `/api/revalidate` 502) pass and assert "… trong vòng 12 giờ" (`e2e-warning-tests.txt`, with the command that selects exactly P5 and C6); C6 fails on `0cfcd7d` by construction (it says "5 phút"), not run there |
| e2e full, Chromium desktop + WebKit iPhone (before C6) | 69 pass / 16 fail (`e2e-full-default.txt`). Author-reported classification, from runs recorded outside this directory (`docs/qa/evidence/rsc-perf-v2/e2e-summary.txt` on `perf/rsc-nav-v2`): A1, A2, A7, A8, P2, C4, 17, 19, S1, H1 ×2 also fail on the earlier baselines; A6, P5, P6, G1, S4 pass when run alone and failed the same way on other builds in the same order. P5 passed alone here (`e2e-warning-tests.txt`) |
| Build | OpenNext, production env, clean `.next`: pass; image allowlist `fyaourksnjeldsvuedox.supabase.co`; no test hosts; bundle secret scan PASS (`build-check.txt`) |
| Worker CPU | not measured. The render code path is unchanged (one header string). A HIT still runs the gateway entrypoint (credential check, then the `PublicCache` binding) but not the Next render or any Render call |
| Purge on the current RPC path | **open**: `run-purge-probe.ps1` / `purge-probe.mjs` ready (§5); control (invalid token) 401 + still HIT; the authenticated run needs the owner's Admin login in the owner's own terminal |
| Render calls on HIT | not verified here (Render logs): post-deploy gate §5.2 |

Codex final (after the Workers Cache facts, rollback partitions and purge runner): round 6 REQUEST_CHANGES (P1: Supabase Auth origin from the env file not validated) → fixed (pinned origin) → round 7 **APPROVE**, no P0–P3 (`codex-review-r6.txt`, `codex-review-r7.txt`). Earlier: round 1 REQUEST_CHANGES (P1 rollback statement, P2 emergency propagation, P2 RSC evidence, P2 retry wait, P3 evidence logs, P3 category warning test): all addressed in this report and `4da469d`. Round 2 REQUEST_CHANGES (P2 emergency propagation check, P3 evidence, P3 forged-eviction cost): addressed in §3, §4.4 and §6 (`codex-review-r2.txt`).

**Verdict: BLOCKED until the owner's authenticated purge proof (§5, `run-purge-probe.ps1` on preview `335c619f`) returns AUTH_PURGE_PREVIEW_PASS.** Then CACHE_12H_READY_FOR_DEPLOY for its own controlled P → P′ → N rollout (never combined with RSC V2), with the post-deploy gates of §5 (MISS → HIT, TTL 43200, purge MISS after an admin save at two `cf-ray` locations). Codex: round 7 APPROVE. If a purge gate fails after deploy, roll back (§7): a 12 h TTL without a working purge keeps hidden content public for up to 12 h.

## 7. Rollout and rollback

- Release: Worker only (no backend, DB or config change), through `TASK_P1_ASSET_VERSION_SKEW.md` P → P′ → N with P = `ace736be` (`0cfcd7d`). Build from a clean `.next` with the production env (image allowlist check). The preview `335c619f` carries this build's assets plus `0cfcd7d` and `e681cca` (archived in `apps/web/.deploy-assets/4da469d`).
- Rollback: deploy P′ (`0cfcd7d` code, TTL 300, N's assets). P′ is created fresh for this release and only ever serves with TTL 300, so its partition holds entries at most 5 min old; a rollback to it never serves 12 h entries. A rollback does **not** delete N's 12 h entries: they stay in N's partition until they expire (≤ 12 h), unused while N is not deployed.
- Never re-deploy an existing version that served with the 12 h TTL (N, or a later 12 h version) after it has been replaced: upload a new version instead (empty partition). If one must be re-deployed, make an admin save right after the switch (the purge then runs in that version's own `PublicCache`) and verify at two `cf-ray` locations (§4.4) before considering its old entries gone.
- A rollback to the pre-12 h production version `ace736be` is not planned (P′ supersedes it); if ever needed, the same rule applies: its partition only ever held 300 s entries.
- Not combined with RSC V2: separate branches and releases; whichever ships second is rebuilt on top of the first and goes through its own P → P′ → N.
