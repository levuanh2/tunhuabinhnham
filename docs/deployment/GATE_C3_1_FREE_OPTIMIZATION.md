# Gate C3.1 — Workers Free optimisation

Date: 2026-10-13 (UTC+7). Branch `gate-c31/cache` (`4d59c8c`, `e1a4cd7`, `de754e8`, `981ccbc`), merged into `integration/warm-editorial-v2` (`03f9a5e`).

**Deployed to production** (owner-approved controlled rollout, see "Production rollout"): Worker `tunhuabinhnham-web` runs version `213692b4-06c3-4e26-86bc-681d49b33e64` at 100% since 2026-10-13T03:00:21Z. Rollback target: `46243813-a2ad-4dca-976c-d960f95f20ca` (Gate C3).

## Verdict

**FREE_VIABLE_WITH_RISK** (final for this gate). Cache purge PASS, admin/auth PASS, Render commit verified, no rollback condition triggered. Workers Free and Render Free are kept.

- Cached pages and prefetches no longer run the Worker: in a controlled block, 35 public requests needed only 7 Worker invocations (80% fewer). Across 356 production invocations there were 0 CPU-limit exceptions and 0 errors.
- A cache MISS still costs more than 10 ms CPU (warm p50 28.5 ms). Free has tolerated this so far (no error 1102), but nothing guarantees it will keep doing so.
- With Workers Cache on, **static asset requests count toward the Free quota of 100,000 requests/day**. A fresh visitor's first page view costs about 35 requests (1 HTML + 24 assets + 10 prefetches) instead of about 11.
- Not FREE_VIABLE: misses regularly exceed 10 ms, and the request quota now also covers assets.

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

## Production rollout (controlled rollout gate)

### Predeploy (Phase 1): PASS

| Check | Result |
|---|---|
| Account / Worker | the logged-in account owns `tunhuabinhnham-web`; custom domains `tunhuabinhnham.com` and `www` unchanged |
| Versions | `213692b4` (tag `c31-cookie-fix`) and `46243813` both exist; production was `46243813` @100%, no drift |
| Code identity | app source of `981ccbc` equals `03f9a5e`; `.open-next` is the build uploaded as `213692b4` |
| Cache safety tests | Vitest 16/16; workerd Playwright 41 passed / 0 failed (tests 18–22); Cloudflare preview replay matrix |
| Secrets | bundle scan: no service-role key, DB URL, JWT secret or password (the only matches on the password string were build-machine file paths) |
| Rollback | `npx wrangler versions deploy 46243813-a2ad-4dca-976c-d960f95f20ca@100%`: instant, and the per-version cache key keeps stale entries from crossing versions |

Private-content safety rests on the design, not on one byte-identical response:
- The wrapper stores only GET/HEAD requests for allowlisted public paths, with no `Authorization` and no Supabase session cookie.
- The response must be a 200 `text/html` (or a signed `text/x-component`) without `Set-Cookie`, from a render that did not degrade.
- `/admin*` and `/api/*` never pass the allowlist.
- A unit guard fails if any public route, the root layout, the header/footer/nav or the API client reads cookies, headers, draft mode or the session.

The last point is what makes a cookie-bearing HIT safe: the cached page cannot depend on who asks.

### Deploy (Phase 2)

Strategy: **a single, monitored 100% cutover**, not a gradual rollout. Skew protection is not configured, so a split would serve HTML from one version while its chunks and `_rsc` requests land on the other. The per-version cache key makes rollback clean.

| | |
|---|---|
| Command | `npx wrangler versions deploy 213692b4-06c3-4e26-86bc-681d49b33e64@100%` |
| Deployment created | 2026-10-13T03:00:21.350Z, message "Gate C3.1 Workers Cache rollout" |
| Version | `213692b4-06c3-4e26-86bc-681d49b33e64` @100% (re-confirmed after 04:05Z) |

### Live verification on `https://tunhuabinhnham.com` (Phase 3)

| Check | Result |
|---|---|
| `/`, `/san-pham`, `?category=`, `?search=`, product detail, `/tin-tuc`, news detail, `/lien-he`, `/gioi-thieu` | 200; 1 MISS, then HIT |
| `/admin`, `/admin/login`, `/admin/san-pham`, unknown product (404) | BYPASS, `private, no-store` |
| `sitemap.xml`, `robots.txt` | 200, not stored (Next's own `public, max-age=0, must-revalidate`) |
| SEO | public.spec 6/6 on the apex (canonical = apex, robots, sitemap origin) |
| Signed RSC replay | original headers → HIT; no router headers → BYPASS (private HTML); `rsc` only or altered state tree → 307 BYPASS |
| Session cookie on a cached public URL | HIT, anonymous page (safe because of the guard above) |
| Session cookie on `/admin/san-pham` | 307 BYPASS |
| Corrupted `sb-*-auth-token` | 307 to `/admin/login` (was 500 on `46243813`) |
| Browsers, Chromium + WebKit, 3 visits each | HTML, 24 assets and ~10 prefetches HIT; 0 page errors; load 1.2–1.5 s |
| Mobile | 80 screenshots (8 pages × 5 widths × 2 engines): 0 horizontal overflow, 0 real errors (`screenshots-c31/`) |
| Backend | `/health/live` 200 (0.37 s), `/health/ready` 200 (1.18 s), CORS preflight from the apex 200, anonymous admin endpoint 401 |
| Admin login, session after reload, logout + Back on the apex | PASS: the owner logged in on the apex and confirmed. Tail: admin pages 200 (each loaded twice, the session held), `POST /api/auth/logout` 200 at 05:28:57, then `/admin` 307 to login at 05:29:00. No admin response was public |

Measurements (production, from `wrangler tail` and `curl` run in Vietnam):

| Metric | Value |
|---|---|
| Response time, HIT | p50 0.179 s, p95 0.213 s |
| Response time, MISS | p50 1.414 s, p95 2.387 s |
| Requests vs Worker invocations (controlled block) | 35 public requests → 7 invocations (80% answered by the cache without running the Worker) |
| MISS CPU, cold isolate right after the deploy | 24, 29, 192, 197, 204, 388, 402 ms |
| MISS CPU, warm isolate, deliberate misses (n=20) | p50 28.5 ms, p95 88 ms, 20/20 > 10 ms; wall-clock p50 794 ms. Baseline SSR without the wrapper was 18 ms; buffering the body adds about 10 ms |
| Production invocations 03:00–04:05Z | 356, all `ok`; 0 exceptions; 0 CPU-limit (1102) errors; status 200: 182, 404: 162, 307: 11, 308: 1 |
| Source of the 404s | vulnerability scanners (`/.git/config`, `/.svn/*`, `/.hg/*`, `wp-*.php`, `*.php`), plus 12 deliberate test 404s; not caused by the release |
| 5xx | 0 |

HITs never appear in the tail because the Worker does not run for them. Every tailed invocation is therefore a MISS, a BYPASS or a non-cacheable route, and all CPU figures above are for requests that ran the Worker.

### Cache invalidation (Phase 4): PASS

Authorised: one real CMS settings save by the owner (a real hotline or Messenger link). The owner changed the hotline at 12:28 ICT (05:28Z). No other write was made.

| Time (UTC) | Event (production tail + `curl`) |
|---|---|
| 03:07–04:04 | watcher: `/` and `/lien-he` HIT with placeholder `tel:0900000000` |
| 05:27:56 | anonymous browser `GET /` (no cookie, no router headers): Worker ran, 200, wall 1.99 s, no API error. This stored a fresh entry with the old value, valid until 05:32:56 |
| 05:28:21–05:28:23 | signed-in admin pages (`/admin`, `/admin/cai-dat`, …) 200, never cached |
| 05:28:45 | `POST /api/revalidate` with `Authorization`: **200** (the route returns 502 if the tag purge throws) |
| 05:29:20 | `curl /`: **MISS**, new hotline `tel:0963542815`, 84 s after the entry was stored and 35 s after the purge, well inside the 300 s TTL |
| 05:29:23 | `curl /lien-he`: MISS, new hotline |
| later reads | `/`, `/lien-he`, `www` HIT with the new hotline; old value absent (`0900000000` count 0); `/san-pham` new hotline |

The entry written at 05:27:56 would have been a HIT until 05:32:56 without a purge. It was gone at 05:29:20, so `ctx.cache.purge({ tags: ["public-html"] })` works in production.

Limit: the tail does not record response headers, so the 05:27:56 store is inferred from the cache policy (anonymous, 200, non-degraded render) rather than observed.

The page has no JSON-LD `telephone` field, so there is no metadata to update. The Messenger and Facebook links are still placeholders (`https://m.me/`, `https://facebook.com/`), because only the hotline was changed.

### Free capacity and static assets (Phase 5)

- `run_worker_first` is not set (default `false`), so it is not why assets count: with `false`, assets are matched before the Worker runs.
- Assets count because **Workers Cache is enabled for the whole Worker**: with caching on, static asset requests are billed as requests (Cloudflare `workers/cache` billing notes). There is no documented per-path exclusion.
- Option for a later, separately tested release: enable the cache only on a named render entrypoint (`exports.<Name>.cache.enabled`) and have the default entrypoint forward cacheable page requests to it through `ctx.exports`. Assets would be free again and tag purge would keep working. Not changed in this release, as the brief requires.
- Bots: scanners requested about 150 non-existent paths in one hour. 404s are never cached, so each one runs the Worker and counts toward the quota. A free WAF custom rule that blocks `*.php`, `/.git`, `/.svn` and `/.hg` would remove most of them. This is an owner decision and needs no DNS change.

### Render (Phase 6): VERIFIED (deployed commit) — **CORRECTED 2026-10-13: the redaction fix was not in the code**

> **Correction:** the check below established the deployed commit and its ancestry, not file content.
> - `5248e27`, a test-only commit, reverted the two fix lines of `96884dc` (`hide_input_in_errors=True` in `core/config.py`; `sys.excepthook` through the redacting formatter in `core/logging.py`).
> - So `416cd02` and `b532ac4` ran **without** the startup-redaction fix, and both startup tests in `test_logging.py` failed on them.
> - Hotfix `6f48006` (parent `b532ac4`, same lines as `96884dc`) passed pytest 70/70, ruff and mypy, and was fast-forwarded to `deploy/c2-preview`.
> - The owner ran Manual Deploy (auto-deploy is off): GitHub deployment 7034527688 `success` at 2026-10-13T09:11:24Z.
> - Smoke: `/health/live` 200, `/health/ready` 200, CORS apex 200 (unknown origin 400), anonymous admin 401.


Render reports each deploy to GitHub as a deployment of `levuanh2/tunhuabinhnham`, environment `deploy/c2-preview - tunhuabinhnham-api`. The latest record shows commit `416cd0201b81`, state `success`, at 2026-10-12T21:05:34Z, with environment URL `https://tunhuabinhnham-api.onrender.com`. `git merge-base --is-ancestor a99bed4 416cd020` succeeds, so the running commit contains the startup/log redaction fixes (`ca7416e`, `96884dc`, `7cceb99`).

Codex found the same commit independently (`C31_ROLLOUT_ACK.md`, verdict **ACK**). Its read-only checks:
- health 200/200;
- CORS preflight from the apex 200, exact origin, `no-store`;
- anonymous admin endpoint 401 `WWW-Authenticate: Bearer`;
- no private-cache leak path in `edge-cache.ts` / `worker.ts`.

Note: the Render API key in this session belongs to a different workspace and was not used for this service.

### Rollback conditions (Phase 7)

None triggered: no private-content leakage, no auth regression found, no CPU-limit errors, no 5xx, all public routes 200, HTML/RSC variants correct, SEO checks pass.

## Pending (needs owner action)

1. **P0 security (open)**: the PostgreSQL password was based on the brand name, and the pooler user `postgres.<ref>` follows from the public Supabase URL, so it is guessable. The owner rotated it at 12:31 ICT:
   - Render redeployed `b532ac4` (contains `a99bed4`) at 05:32:51Z, and `/health/ready` (`select 1`) returned 200 afterwards.
   - The new password is still the brand name plus 4 characters (checked by length and pattern only; the value was never printed). Brand-plus-suffix is a standard guessing pattern.

   Rotate again to a password-manager-generated random value. Steps:
   1. Reset it to a long random value in Supabase.
   2. Update `DATABASE_URL` on Render, then Manual Deploy.
   3. Update `apps/api/.env`.
2. Optional: enter the real Messenger/Facebook links in Admin → Cài đặt (they are still placeholders).
3. Optional: a free WAF custom rule against scanner paths (Phase 5).

## Remaining risks

- Cache MISS CPU still exceeds 10 ms; on Free each miss risks error 1102 (none seen so far).
- Request quota consumption roughly triples for fresh visitors because assets become billable.
- Purge works in production (Phase 4). If a purge is ever lost, the 5-minute TTL is the backstop; Free-tier purge rate limits apply to bursts of admin saves.
- Bot 404 traffic runs the Worker on every request (404s are never cached, by design).
- The database password is weak (P0 under "Pending") until it is rotated.
- Render Free cold start (37.65 s) makes the first MISS after idle slow; it is not cached as degraded, because a slow response is still a success.

Alternative if the request quota becomes the constraint: drop `cache.enabled` and cache HTML with the Cache API (`caches.default`) inside `worker.ts`. Assets stay free and HIT CPU is about 1–3 ms, but purge only clears the local data centre, so invalidation would rely on a short TTL. Workers Paid ($5/month) removes both limits.
