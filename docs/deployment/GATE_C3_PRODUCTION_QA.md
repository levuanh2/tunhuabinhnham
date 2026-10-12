# Gate C3 — custom domain and production QA

Date: 2026-10-13 (UTC+7). Web in production: **`6f03aa5`** (Worker version `46243813-a2ad-4dca-976c-d960f95f20ca`). Backend: Render service redeployed by the owner from `deploy/c2-preview` after the password rotation; the exact deployed commit was not read back (see below). Integration / `deploy/c2-preview` head: see "Final verification". Backend security detail: `GATE_C3_BACKEND_SECURITY.md` (Codex).

Legend: **PASS** (verified by Claude or Codex against production), **OWNER-REPORTED** (owner confirmed; no independent evidence), **NOT VERIFIED**, **BLOCKED**.

## Verdict

**Gate C3: BLOCKED — not production-ready.**

The domain, redirects, SEO, CORS, API protection, credential rotation and mobile layout pass. What still blocks a production sign-off:

1. **Workers Free CPU** (billing decision): 68 of 78 full-page requests exceeded the 10 ms Free limit on live traffic. Workers Paid ($5/month) is required; nothing was purchased.
2. **Content** (owner data): placeholder Messenger/Facebook links, hotline and address; no logo, favicon, products, posts or banners.
3. **Unverified owner-side evidence:** the deployed Render commit and the Render log search were reported "OK" by the owner without the commit SHA or match counts; the apex admin session left no admin requests in the Worker log captured during the check. These are recorded as OWNER-REPORTED, not PASS.

Operational risks accepted for now: Render Free cold start (37.65 s after idle), single 512 MB Free instance.

## Final verification (after owner rotation, DNS and HTTPS changes)

| Check | Result | Evidence |
|---|---|---|
| DB password rotated | PASS | local read-only check with the new `.env`: fingerprint `cbda20f5bbaa`, revision `0004`, `transaction_read_only=on`, new password alphanumeric, `auth.sessions` SELECT true, 1 active admin, store name intact. The leaked fragment belongs to the old password |
| Render uses the new credential | PASS (inferred) | `/health/ready` 200 (`SELECT 1`) after the old password was replaced |
| Render runs the redaction fix | OWNER-REPORTED | no endpoint exposes the commit; owner said "ổn hết" without the Events SHA. Expected `416cd02` or later |
| Render logs free of secrets | OWNER-REPORTED | owner did not send match counts for `Traceback`, `postgresql`, `password`, `Bearer`, `eyJ` |
| Worker logs free of secrets | PASS | tail during QA and the owner window: 0 JWT, 0 bearer, 0 `postgres://`, 0 `sb_secret_`, 0 DB-password matches, 0 `sb-*-auth-token` cookies; 0 exceptions |
| HTTP → HTTPS | PASS | `http://tunhuabinhnham.com/san-pham?category=do-dung&x=1` → `301 https://tunhuabinhnham.com/san-pham?category=do-dung&x=1` |
| WWW → apex | PASS | `https://www.tunhuabinhnham.com/san-pham?category=do-dung&x=1` → `301 https://tunhuabinhnham.com/san-pham?category=do-dung&x=1`; `http://www…/san-pham?x=1` reaches the apex in 2 hops with path and query kept. `www` is now proxied (`2606:4700:3035::ac43:c29b`); certificate SAN `tunhuabinhnham.com, *.tunhuabinhnham.com` |
| CORS | PASS | apex and `workers.dev` preflight 200 with exact ACAO; `www` and `evil.example.com` 400, no ACAO |
| Protected APIs | PASS | `/admin/dashboard/stats`, `/admin/products`, `/admin/site-settings`, `/admin/posts`: anonymous 401, bogus bearer 401; anonymous `PATCH /admin/site-settings` 401 (nothing written) |
| Public pages + SEO | PASS | `public.spec.ts` 6/6 on the apex and 6/6 on `workers.dev` (Chromium + WebKit): canonical, robots and sitemap on `https://tunhuabinhnham.com` |
| Mobile (emulated) | PASS | 80 shots (8 pages × 5 widths × Chromium/WebKit): overflow 0, page/console/HTTP errors 0 (besides the intended 404), Be Vietnam Pro loaded |
| Admin login, SSR session, Settings, logout on apex | OWNER-REPORTED | owner confirmed; the Worker log captured during the check shows no admin requests (only `GET /` and a `GET /login` 404). On `workers.dev` the same flow was log-verified in Gate C2.1 |
| Old JWT after logout → 401 | OWNER-REPORTED / NOT VERIFIED | needs the DevTools replay described in the backend report §3 |

### Code changes in this pass (need a Render redeploy only if not already deployed)

- `5248e27` test: a real `uvicorn` start with synthetic secrets from an empty working directory must exit non-zero and print only redacted JSON. Requested by Codex's review of `96884dc` (`C3_REVIEW=CHANGES`: the unit test called `sys.excepthook` by hand). On `7cceb99` it fails, and the raw traceback shows **the tail of the synthetic `sb_secret_` key** inside pydantic's truncated `input_value` — so the pre-fix leak was real, not theoretical. Backend: 70 passed, ruff and mypy clean.
- Test-only change: Render does not need a redeploy for it. The runtime fix it guards (`96884dc`) is in `a99bed4` and later.

### Workers Free CPU on live traffic (419 requests, `wrangler tail`)

| Request type | n | median | p90 | max | > 10 ms |
|---|---|---|---|---|---|
| Full HTML page | 78 | 18 ms | 56 ms | 95 ms | **68** |
| RSC prefetch (`?_rsc=`) | 341 | 5 ms | 24 ms | 215 ms | 68 |

All 419 outcomes `ok`, 0 exceptions. Correction to the first C3 pass: prefetches are 81 % of Worker requests but cheap (median 5 ms), so they mainly multiply the **request count** (Free: 100,000/day), not CPU. Full-page SSR is what exceeds 10 ms. Verdict unchanged: **Workers Paid required** for production.

### Render (unchanged measurements)

Cold start after 20 minutes idle: 37.65 s; warm `/health/live` ~0.1–0.3 s; `/health/ready` ~0.8–1.0 s (client-side, includes internet/TLS). Memory: owner Metrics not reported. Starter `0.5c-512mb` (~US$7/month) removes spin-down; not purchased.

## Remaining owner actions

1. Decide Workers Paid ($5/month).
2. Enter real CMS content (Messenger, Facebook, hotline, address, logo, favicon, products, banners).
3. To turn OWNER-REPORTED into PASS: Render Events commit SHA; Render log match counts (numbers only); one admin sign-in on the apex while Claude watches the Worker log; the DevTools replay → 401.
4. Optional: Render Starter to remove the 37 s cold start.

## First pass (earlier on 2026-10-13)

The sections below record the first C3 pass. The DNS, HTTPS and credential items they list as blocked are resolved above.

| Area | Status at first pass |
|---|---|
| Apex domain public pages | PASS |
| `workers.dev` mirror | PASS |
| SEO | PASS after fix `6f03aa5` |
| CORS | PASS |
| DNS / `www`, HTTP → HTTPS | BLOCKED / FAIL (since resolved) |
| Security P0 (DB credential) | BLOCKED (since resolved) |
| Worker CPU vs Free | FAIL for Free |
| Content readiness | FAIL |

## 1. DNS and domain

| Record | Value (public DNS, 1.1.1.1) |
|---|---|
| NS | `dolly.ns.cloudflare.com`, `sage.ns.cloudflare.com` |
| `tunhuabinhnham.com` A / AAAA | `104.21.52.28` / `2606:4700:3035::ac43:c29b` (Cloudflare proxy → Worker) |
| `www.tunhuabinhnham.com` A | `137.59.106.69` (TenTen, DNS only) |
| MX, TXT | none |
| `mail`, `ftp`, `webmail`, `cpanel`, `smtp`, `pop`, `imap`, `admin`, `api`, `shop`, `m` | no records |

What `www` serves today: `http://` → IIS "Web Server's Default Page"; `https://` → `303 /login.php` (which redirects to itself), certificate `CN=*.tenten.vn` (name mismatch). There is no live site, mail or other service to keep, so moving `www` is safe.

**Proposed change (not applied; owner approval required):**
1. DNS: replace `www` `A 137.59.106.69` with `CNAME www → tunhuabinhnham.com`, **Proxied**.
2. Rules → Redirect Rules → template "Redirect from WWW to root": `https://www.*` → `https://${1}`, **301**, preserve query string.
3. SSL/TLS → Edge Certificates → **Always Use HTTPS** on.
4. Verify: `curl -I https://www.tunhuabinhnham.com/san-pham?x=1` → `301 Location: https://tunhuabinhnham.com/san-pham?x=1`; `curl -I http://tunhuabinhnham.com/` → 301 to HTTPS.
5. Rollback: delete the redirect rule and restore the `www` A record (TenTen IP, DNS only).

`www` does not need to be added to `CORS_ORIGINS`: browsers never run the app on `www` once it redirects.

## 2. Auth and CORS

| Origin | Preflight (PATCH, authorization) | GET `Access-Control-Allow-Origin` |
|---|---|---|
| `https://tunhuabinhnham.com` | 200 | exact origin |
| `https://tunhuabinhnham-web.tunhuabinhnham.workers.dev` | 200 | exact origin |
| `https://www.tunhuabinhnham.com` | 400 | none |
| `http://tunhuabinhnham.com` | 400 | none |
| `https://evil.example.com` | 400 | none |

Every origin with a bogus bearer → 401. Anonymous admin routes → 401, `no-store` (Codex). `/admin` on the apex without a session → `307 /admin/login`, `Cache-Control: private, no-store`.

Pending owner checks on the apex: login, Admin → Cài đặt (view only), reload (SSR session), logout + Back, and the DevTools replay of a pre-logout API request (expect 401).

## 3. SEO

Found on the live apex before this gate's fix:
- `robots.txt` → `Sitemap: https://tunhuabinhnham-web.tunhuabinhnham.workers.dev/sitemap.xml`;
- `sitemap.xml` → every `<loc>` on `workers.dev`;
- `/`, `/san-pham`, `/tin-tuc`, `/lien-he`, `/gioi-thieu` → no canonical.

Cause: the Worker was built with the preview `NEXT_PUBLIC_SITE_URL`, and the static pages never declared `alternates.canonical`.

Fix `6f03aa5`: canonical on the five static pages, plus a `public.spec.ts` test that checks canonical, robots and sitemap use the site origin. It failed on the old live build (negative control) and passes after the rebuild with `NEXT_PUBLIC_SITE_URL=https://tunhuabinhnham.com`.

After redeploy, on both origins: `<link rel="canonical" href="https://tunhuabinhnham.com"/>`, robots `Sitemap: https://tunhuabinhnham.com/sitemap.xml`, sitemap entries on the apex. The `workers.dev` mirror now canonicalises to the apex (no duplicate content). Titles follow the CMS store name; `og:site_name` = "Tủ Nhựa Bình Nhâm". No `localhost` in the bundle; `workers.dev` appears only in OpenNext's skew-protection library code. Product and article routes keep their own canonical/OG (Gate C2.0); there is no published product or article to test live yet.

## 4. Security blockers

- **DB credential (P0):** a fragment was printed in a Claude tool output (Gate C2.1). Codex scanned Git history (51 commits, 5,548 blobs), the workspace, harness logs, scratch files and PowerShell history without printing values: no second copy apart from the expected ignored `apps/api/.env`. Render logs were not inspected (no access). **Rotation runbook:** backend report §1. Not rotated yet (owner deferred in C2.1).
- **Redaction gaps — fixed in code, not yet running on Render:**
  - Codex `7cceb99`: the redacting formatter is installed when the `app` package is imported, before settings validation or the SQLAlchemy engine; the redactor also catches scheme-less `user:password@host` fragments and unencoded `@`.
  - Claude `96884dc`: a failed production `Settings` validation printed a **raw traceback** whose pydantic message embeds `input_value={...all settings...}`. A probe with synthetic secrets showed only truncation was hiding `DATABASE_URL`. Fix: `hide_input_in_errors=True` and `sys.excepthook` routed through the redacting JSON formatter. Startup failures are now one JSON `CRITICAL` line naming the missing variables only. The new test fails on `7cceb99`.
  - Backend 69 passed, ruff and mypy clean. Pushed in `deploy/c2-preview` @ `a99bed4`; it takes effect at the next Render deploy (auto-deploy off), which the password rotation needs anyway.
  - `deploy/c2-preview` also carried `59f01f7` (removes `maxShutdownDelaySeconds`, unsupported on Render Free), pushed outside this session during Blueprint creation; merged, not overwritten.
- **Secrets:** Worker bundle checked against the real secret values: clean. Production `npm audit`: 0. pip-audit on the lockfile: clean.
- **JWT revocation:** unit-tested; live replay not verified. The legacy HS256 path relies on Supabase `/auth/v1/user`, not the `auth.sessions` check (backend report §3).

## 5. Worker CPU (live apex, `wrangler tail`, 53 sampled requests)

| Route | n | min | median | max | > 10 ms |
|---|---|---|---|---|---|
| `/` | 4 | 19 | 25 | 47 | 4 |
| `/san-pham` | 5 | 16 | 32 | 35 | 5 |
| `/san-pham?category=do-dung` | 5 | 21 | 23 | 43 | 5 |
| `/san-pham/<missing>` (404) | 5 | 23 | 28 | 40 | 5 |
| `/tin-tuc` | 5 | 12 | 28 | 34 | 5 |
| `/tin-tuc/<missing>` (404) | 5 | 19 | 29 | 43 | 5 |
| `/lien-he` | 5 | 13 | 21 | 28 | 5 |
| `/gioi-thieu` | 5 | 14 | 16 | 25 | 5 |
| `/admin/login` | 5 | 12 | 55 | 80 | 5 |
| `/sitemap.xml` | 5 | 4 | 6 | 189 | 2 |
| `/robots.txt` | 4 | 5 | 6.5 | 7 | 0 |

All 53 outcomes `ok` (no `exceededCpu` yet). Overall median 23 ms, p90 43 ms; 46/53 over the Free limit. Every SSR route exceeds 10 ms. Earlier sample (C2.1, `workers.dev`): up to 370 ms on a cold isolate.

**Prefetch amplification:** one page view of `/` triggered about 13 RSC prefetch requests (`?_rsc=`) for the header/footer links, each rendered by the Worker and each calling the API. This multiplies Worker requests, CPU and Render load per visitor.

Options, in order of effort:
1. **Workers Paid ($5/month)** — required for reliable production; CPU per request then has a 30 s default limit.
2. Disable prefetch on navigation links (`prefetch={false}`): fewer Worker and API calls per visit, at the cost of slower first navigation. Not applied; owner decision.
3. R2 incremental cache plus ISR for public pages: cached hits avoid SSR CPU. Needs an R2 bucket (new resource) and a change of the request-time rendering strategy; not in scope.

**Verdict: Workers Paid is required** before production traffic. Free can keep serving the preview while the risk is accepted.

## 6. Render (Codex)

- Cold start (controlled 20-minute idle): `/health/live` 37.65 s; warm 103 ms.
- Warm run, 10 samples each: `/health/live` median 326 ms (p95 458 ms); `/health/ready` (`SELECT 1`) median 1,036 ms (p95 1,516 ms). Client-side timings include internet and TLS; Render→Supabase latency cannot be isolated without a Render shell.
- Sydney connectivity: `/health/ready` 200; local read-only preflight confirms fingerprint `cbda20f5bbaa`, revision `0004`.
- Memory: NOT VERIFIED — owner reads Render → Metrics (working set baseline/peak vs 512 MB, OOM/restart events).
- Starter `0.5c-512mb`: US$7/month per instance (confirm at checkout). Removes spin-down, 5× CPU (0.5 vs 0.1), adds shell access; same 512 MB memory and same Singapore↔Sydney distance.

## 7. Mobile QA (live apex, emulated viewports)

`docs/deployment/screenshots-c3/`: 8 pages (`/`, `/san-pham`, search, `/tin-tuc`, `/lien-he`, `/gioi-thieu`, `/admin/login`, missing product) × 360/390/430/768/1440 × Chromium and WebKit = 80 shots.

- Horizontal overflow: 0. Page errors: 0. HTTP errors: 0 apart from the intended 404 page.
- `requestfailed` entries were `net::ERR_ABORTED` on duplicate RSC prefetches cancelled by Next; the same prefetches returned 200.
- Fonts: Be Vietnam Pro (body) loaded; Vietnamese diacritics render.
- Real phones: not tested.

Playwright `public.spec.ts` on the live apex and on `workers.dev` (with `E2E_CANONICAL_ORIGIN`): **6/6 each** (Chromium + WebKit). The write-capable suites were not run against production.

## 8. Content readiness (read-only)

| Item | Live value | Status |
|---|---|---|
| Store name | Tủ Nhựa Bình Nhâm | OK |
| Logo, favicon | empty; `/favicon.ico` 404 | Missing |
| Messenger CTA | `https://m.me/` (generic) | Placeholder |
| Facebook | `https://facebook.com/` | Placeholder |
| Hotline | `0900 000 000` | Placeholder |
| Address | "Cập nhật địa chỉ trong CMS" | Placeholder |
| Default SEO title/description | empty (code fallback used) | Optional |
| Categories | "Đồ dùng", "Quà tặng" (seed), no images | Review |
| Products, posts, banners | 0, 0, 0 | Empty states render correctly |
| Product images on mobile | none to test | Not verifiable |

All of this is CMS data for the owner to enter; nothing was written.

## 9. Regression

| Suite | Result |
|---|---|
| ESLint, TypeScript, Vitest | PASS, PASS, 4/4 |
| OpenNext build, workerd Playwright (fixture), Chromium + WebKit | **36 passed, 14 skipped, 0 failed** (two new canonical tests) |
| Backend ruff, mypy, pytest | PASS, PASS, 66 passed |
| `npm audit --omit=dev` | 0 |
| Live public Playwright (apex, workers.dev) | 6/6, 6/6 |

## 10. Remaining issues and owner actions

1. Rotate the database password (runbook: backend report §1), then confirm `/health/ready` 200.
2. Approve the `www` DNS + redirect change and "Always Use HTTPS".
3. Decide Workers Paid ($5/month); optionally `prefetch={false}` on navigation.
4. Sign in on the apex and run the admin checks, including the DevTools replay of a pre-logout request.
5. Render dashboard: log search for leaked values (backend report §4) and memory readings.
6. Enter real CMS content: Messenger, Facebook, hotline, address, logo, favicon, products, banners.
7. Redeploy Render from `deploy/c2-preview` (`a99bed4`) together with the password rotation, so the redaction fixes go live.
8. Optional: Render Starter ($7/month) to remove the 37 s cold start.

Rollback: `npx wrangler rollback 0c3003a0-f88c-4eb8-83ad-d60086d859e6` restores the pre-fix Worker. That version has the `workers.dev` canonical bug, so use it only if the new version breaks.
