# Gate C3.1 — Workers Free optimisation

Date: 2026-10-13 (UTC+7). Branch `gate-c31/cache` (`4d59c8c`, `e1a4cd7`, `de754e8`, `981ccbc`), merged into `integration/warm-editorial-v2` (`03f9a5e`). **Not deployed to production**: production is still Worker version `46243813` (Gate C3). The optimised build is uploaded as preview version `213692b4-06c3-4e26-86bc-681d49b33e64` (alias `https://c31cache-tunhuabinhnham-web.tunhuabinhnham.workers.dev`), which receives no production traffic.

## Verdict (provisional)

**FREE_VIABLE_WITH_RISK — pending production measurement.**

- CPU: cached pages and prefetches no longer run the Worker. Only cache misses do, and a miss still costs about the same as before (SSR median 18 ms > 10 ms). Misses happen once per URL per 5 minutes per Cloudflare location, or right after an admin save.
- New risk, specific to this design: with Workers Cache enabled, **static asset requests count toward the Free quota of 100,000 requests/day**. A fresh visitor's first page view now costs about 35 Worker requests (1 HTML + 24 assets + 10 prefetches) instead of about 11.
- The verdict becomes final only after the production measurements in "Pending" are taken. It must not be read as FREE_VIABLE: cache misses still regularly exceed 10 ms.

## Cache architecture

```
browser ──► Workers Cache (key = path + query, per Worker version) ──HIT──► response (Worker not invoked, 0 CPU)
                     │ MISS / BYPASS
                     ▼
              worker.ts (wrapper) ──► OpenNext worker (.open-next/worker.js) ──► Next.js SSR ──► Render API
                     │  decides Cache-Control after the full body is rendered
                     ▼
     public, max-age=0, s-maxage=300 + Cache-Tag: public-html   — or Next's private, no-store (unchanged)
```

Workers Cache facts that drive the design (Cloudflare docs, `workers/cache`, `cache-keys`, `limitations`):
- The cache key is path + query string (order-sensitive) and the Worker version. **Cookie, Authorization and the hostname are not part of it**, so a response marked public is served to every visitor on apex and `workers.dev` alike.
- A request with `Authorization`, or a response with `Set-Cookie`, bypasses the cache automatically. `Cache-Control: private` is honoured.
- Hits are not billed for CPU. Every request (hit or miss), and with caching on also static asset requests, is billed at the request rate. On Free that means it counts toward 100,000/day.
- Purge: `ctx.cache.purge({ tags })` (Free-tier purge rate limits). The default key includes the Worker version, so a deploy or rollback starts with an empty cache: no stale cross-version entries.
- Enabled with `"cache": { "enabled": true }` in `wrangler.jsonc`. Wrangler 4.149.0 (≥ 4.69.0) accepts it; the preview proved it works on the Free plan.

### What may be stored (all conditions, `src/lib/edge-cache.ts`)

| Condition | Rule |
|---|---|
| Method | `GET` or `HEAD` |
| Path allowlist | `/`, `/san-pham`, `/san-pham/<slug>`, `/tin-tuc`, `/tin-tuc/<slug>`, `/lien-he`, `/gioi-thieu` (query strings allowed, e.g. category filter) |
| Request | no `Authorization`; no Supabase `sb-*-auth-token` cookie; either a plain HTML request (no `_rsc`, no router headers) or a signed router request (`rsc: 1` + `_rsc`) |
| Response | status 200; `text/html` (or `text/x-component` for router requests); no `Set-Cookie` |
| Render health | no `apiFetch` call failed or returned non-404 during the render (AsyncLocalStorage flag; the body is buffered before deciding) |

Everything else keeps Next's `private, no-cache, no-store`: `/admin*`, `/api/*`, the logout route, middleware redirects (`/admin` → login carries `private, no-store` and `Vary: Cookie`), 404 pages, `sitemap.xml`/`robots.txt` (Next's own `public, max-age=0, must-revalidate`), image optimisation and static assets (handled before the wrapper).

Router (RSC) requests: Next signs `_rsc` with a hash of the router headers and answers a mismatched hash with 307, so path + `_rsc` identifies the variant and a forged combination is never stored. `Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch` stays on every cached response, so an HTML entry can never answer a router request.

### Invalidation

- Every admin mutation already calls `POST /api/revalidate` (admin bearer verified against the API). The route now also calls `purgeEdgeCache(getCloudflareContext().ctx)`, which purges tag `public-html` across all hostnames. A purge error returns 502, so the admin sees "Nội dung đã lưu nhưng chưa thể làm mới cache công khai".
- Backstop: `s-maxage=300`. If a purge is lost, or `ctx.cache` is unavailable, a hidden product can stay visible for at most 5 minutes.
- API failure never replaces a good page: a degraded render is served `private, no-store` and not stored, and the previous cached copy expires normally.

### Static-first evaluation (Task 4)

| Page group | Decision | Why |
|---|---|---|
| Home, catalogue, category filter, product detail, news list, news detail, contact, about | SSR + edge cache | Content comes from the CMS; prerendering at build time reintroduces the Gate C2 build-time API dependency (stale branding if the API is down during a build) and OpenNext without R2 has no persistent ISR store. The edge cache gives static-like delivery while keeping request-time rendering and explicit purge |
| `sitemap.xml`, `robots.txt` | unchanged (SSR, ~5–7 ms) | below the CPU limit already |
| Admin | unchanged (no cache) | personal, authenticated |

No SPA conversion: HTML is fully server-rendered with metadata, canonical and OG; links stay shareable.

## Files modified

| File | Change |
|---|---|
| `apps/web/worker.ts` (new) | wrapper around the OpenNext worker; applies the policy |
| `apps/web/src/lib/edge-cache.ts` (new) | request/response policy, render-health flag, purge helper |
| `apps/web/src/lib/edge-cache.test.ts` (new) | policy, Vary, render-state, purge and no-personalisation guard tests |
| `apps/web/src/lib/api.ts` | marks the render degraded on network error, any non-OK status and unreadable JSON |
| `apps/web/src/lib/api.test.ts` (new) | degraded-marking unit tests |
| `apps/web/src/middleware.ts` | corrupted session cookie → login redirect + cookie cleared (was 500) |
| `apps/web/src/app/api/revalidate/route.ts` | purges the edge cache after the admin check |
| `apps/web/wrangler.jsonc` | `main: worker.ts`, `cache.enabled: true` |
| `apps/web/e2e/responsive.spec.ts` | tests 18–22 |
| `apps/web/e2e/fixtures/mock-api.mjs` | `POST /__outage?on=1` switch (test fixture only) |

No backend, schema, DNS or design change.

## Security regression (Task 3)

| Requirement | Test | Result |
|---|---|---|
| Anonymous cannot read a cached admin page | 18: `/admin`, `/admin/san-pham`, `/admin/login` never public; 19: after logout an anonymous context gets the login redirect | PASS |
| Admin A never receives admin B's content | admin responses are never marked public (18, 19: every `/admin*` and `/api/*` response during a signed-in session checked); the cache cannot store them | PASS (by construction + test) |
| Logout does not reuse cached authenticated HTML | 19: logout response not public; post-logout `/admin/san-pham` → login | PASS |
| Redirects carrying session data are not cached | 18: `/admin` 307 private; 21: forged `_rsc` 307 private | PASS |
| No leakage between `workers.dev` and apex | only anonymous public pages are shared (identical content; canonical is the apex) | PASS |
| Session cookie / Authorization on a public page | 18, 19: response served but not stored | PASS |
| API outage | 20: pages rendered during a simulated outage are served but never public; **fails when degraded marking is disabled** (negative control) | PASS |
| Real prefetches | 21: browser prefetches of public pages are public `text/x-component`; forged `_rsc` is not | PASS |
| Preview on Cloudflare | `/admin`, `/admin/login`, unknown product → `BYPASS` ×3 each | PASS |
| Exact-key RSC replay (Cloudflare preview) | signed `_rsc` URL with original headers → HIT; same URL without router headers → BYPASS (private HTML); `rsc` only or altered state tree → 307 BYPASS | PASS |
| Signed-in visitor on a cached public URL | HIT returns the byte-identical anonymous page (same SHA-256); unit guard fails if any public route, root layout, header/footer/nav or API client reads cookies, headers, draft mode or the Supabase session | PASS (accepted, see Codex review #1) |
| Corrupted session cookie | **bug found on production**: `sb-*-auth-token=base64-<invalid>` → `/admin/*` 500. Fixed (`981ccbc`): 307 to login, cookie cleared; e2e 22; preview verified | FIXED (needs deploy) |

## Measurements

### Baseline (Gate C3, production, no cache)

| Request type | n | median CPU | p90 | > 10 ms |
|---|---|---|---|---|
| Full HTML | 78 | 18 ms | 56 ms | **68 / 78** |
| RSC prefetch | 341 | 5 ms | 24 ms | 68 / 341 |

### Optimised build — Cloudflare preview (real edge, Free plan)

Cache status per route (`curl`, 1 cold + 4 warm requests each):

| Route | Result |
|---|---|
| `/`, `/san-pham`, `/san-pham?category=do-dung`, `/tin-tuc`, `/lien-he`, `/gioi-thieu` | 1 MISS, then 4 HIT each |
| `/admin`, `/admin/login`, `/san-pham/<missing>` | BYPASS ×3 |

Response time from this client: HIT 0.17–0.32 s; MISS 0.84–2.95 s.

Real browsers (`/san-pham`, then client navigation to `/tin-tuc`; fresh context each visit):

| Visit | HTML | Assets | RSC prefetch | Page errors | Load |
|---|---|---|---|---|---|
| Chromium #1 (cold) | 1 MISS | 24 MISS | 10 MISS | 0 | 8.3 s |
| Chromium #2, #3 | 1 HIT | 24 HIT | 10 HIT | 0 | 1.2–1.3 s |
| WebKit #1–#3 | 1 HIT | 24 HIT | 10 HIT | 0 | 1.3–2.0 s |

Worker CPU on the preview could not be read: `wrangler tail` only streams the deployed version. CPU on a MISS is expected to equal the baseline SSR cost plus a few ms for buffering; HIT CPU is 0 by platform definition.

### Requests against the Free quota (100,000/day)

| | Worker requests per fresh first page view | Approx. fresh page views/day at the limit |
|---|---|---|
| Before (no cache; assets free) | ~11 (1 HTML + ~10 prefetches) | ~9,000 |
| After (cache on; assets billable) | ~35 (1 + 24 assets + 10) | ~2,850 |

Repeat views in the same browser fetch fewer assets (immutable browser cache), so real capacity is higher. Exceeding the quota returns error 1027 for the whole site until 00:00 UTC (07:00 Vietnam time).

## Regression (Task 7)

| Suite | Result |
|---|---|
| TypeScript, ESLint | PASS |
| Vitest | 16/16 |
| OpenNext build (fixture and production env) | PASS |
| workerd Playwright, Chromium + WebKit (fixture) | **41 passed, 19 skipped, 0 failed** |
| SSR session, logout, protected routes | PASS (tests 17, 19, staging-cms skipped = live-write spec) |
| SEO (canonical/robots/sitemap) | PASS (public.spec) |
| Mobile responsive | PASS (tests 1–11) |
| Visual diff vs Warm Editorial V2 baseline | 85/85 identical |

## Codex review (`C31_REVIEW=CHANGES`) and resolution

| # | Finding | Resolution |
|---|---|---|
| 1 | The cookie check runs only on MISS; a HIT serves the cached page to a request with a session cookie | Accepted as designed: cached entries are only anonymous public pages, and public pages are identical for every visitor. A HIT with a synthetic session cookie returned the byte-identical anonymous body on Cloudflare. A unit guard now fails if any public code path starts reading cookies, headers, draft mode or the session. Admin paths are never cached |
| 2 | Malformed JSON and 404s on collection/settings endpoints could produce a cacheable fallback page | Fixed (`de754e8`): every non-OK status and JSON decode failure marks the render degraded; unit tests |
| 3 | Vary was only completed when `rsc` was missing; the forged-RSC test changed the cache key instead of replaying it | Fixed: every router header is added to Vary; e2e 21 replays the exact signed URL with missing or altered headers (workerd), plus the Cloudflare preview replay above |

Observation: the Next 16 build still performs a few metadata fetches during "Generating static pages" (seen as `.next/cache/fetch-cache` entries; one truncated file produced a harmless OpenNext warning). Runtime does not use them (dummy incremental cache; CMS changes show on the next request), and Gate C2 verified the build passes with the API down.

## Pending (needs owner approval or action)

1. **Production deploy** of version `213692b4`: `npx wrangler versions deploy 213692b4-06c3-4e26-86bc-681d49b33e64@100%`. This also ships the corrupted-cookie fix. Rollback: `npx wrangler versions deploy 46243813-a2ad-4dca-976c-d960f95f20ca@100%` (instant; the old version's cache is separate).
2. After deploy, measure on production: MISS CPU per route, HIT rate, invocation count vs request count, prefetch counts, P50/P95, error rate, and behaviour while Render is cold.
3. **Purge test** (live write): one admin save (for example entering the real hotline in Admin → Cài đặt). Expected: the apex shows the new value on the next request. Verifies `ctx.cache.purge` in production.
4. Signed-in admin check on the apex after deploy (login, Settings, logout).
5. Task 1: Render deployed commit (owner reads Render → Events; must be `a99bed4` or later, otherwise Manual Deploy).

## Remaining risks

- Cache MISS CPU still exceeds 10 ms; on Free each miss risks error 1102 (none seen so far).
- Request quota consumption roughly triples for fresh visitors because assets become billable.
- Purge depends on `ctx.cache` in production (verified only after deploy); the fallback is the 5-minute TTL.
- Render Free cold start (37.65 s) makes the first MISS after idle slow; it is not cached as degraded, because a slow response is still a success.

Alternative if the request quota becomes the constraint: drop `cache.enabled` and cache HTML with the Cache API (`caches.default`) inside `worker.ts`. Assets stay free and HIT CPU is about 1–3 ms, but purge only clears the local data centre, so invalidation would rely on a short TTL. Workers Paid ($5/month) removes both limits.
