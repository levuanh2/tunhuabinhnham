# Gate C2.1 — live deploy report

Date: 2026-10-12/13 (UTC+7). Release: **`579c801`** on `integration/warm-editorial-v2`, pushed as `deploy/c2-preview` to the private repo `levuanh2/tunhuabinhnham` (fast-forward, no force, `main` untouched, 0 CI runs triggered).

Status legend: **DEPLOYED** (running at a public URL), **VERIFIED** (checked against the live URL), **PARTIAL** (some checks pending), **BLOCKED** (needs an owner decision or action).

| Item | Status |
|---|---|
| Backend on Render Free | DEPLOYED, VERIFIED (public + security smoke) |
| Frontend on Cloudflare Workers Free | DEPLOYED, VERIFIED (public, SEO, admin redirect, mobile) |
| Workers Free CPU viability | **BLOCKED for production**: every SSR request exceeds 10 ms (see below). Owner chose to keep Free for the preview and monitor |
| Admin login / logout on the live site | VERIFIED by the owner in their own browser, corroborated by Worker logs (API-side token revocation on the live API: not verified) |
| Render cold start, latency, logs | Cold start VERIFIED; Render↔Supabase latency PARTIAL (external only); log redaction PARTIAL (owner dashboard check) |
| Database password rotation | **Not done**: owner chose to continue without rotating (see incident) |
| Custom domain / DNS | Not started (out of scope) |

## URLs

| Service | URL | Plan | Region |
|---|---|---|---|
| Frontend | https://tunhuabinhnham-web.tunhuabinhnham.workers.dev | Workers Free ($0) | Cloudflare edge |
| Backend | https://tunhuabinhnham-api.onrender.com | Render Free ($0) | Singapore |
| Database | Supabase `fyaourksnjeldsvuedox`, revision `0004` (unchanged) | existing | Sydney (`ap-southeast-2`) |

Worker version: `0c3003a0-f88c-4eb8-83ad-d60086d859e6` (first deployment). The `workers.dev` subdomain `tunhuabinhnham` was registered through the Cloudflare API with the owner's approval.

## Herd coordination

| Task | Owner | Result |
|---|---|---|
| Assignment | Claude → Codex | Acknowledged; Codex worked in its own worktrees (`c21-security-worktree`, `gate-c2.1/security`, `gate-c2.1/render`) |
| T1 Next/PostCSS | Codex trial `6c07c76` (Next 16.4.0) | **Rejected by Claude**: every SSR page 500 in workerd (`Unexpected loadManifest(/.next/server/preview-props.json)`) with OpenNext 1.20.10 |
| T1 accepted | Claude `a62d5ac` (Next 16.3.8) | Codex review: `C21_T1_REVIEW` dependency review OK; dev-only chains not bundled into the Worker |
| T2 Render config | Codex `f06a6bc`, `fd30361`, `5527472` (cherry-picked) | `C21_T2_PLAN=free`; owner decision "Render Free first, upgrade to $7 later" |
| T3 backend smoke / latency / cold start | Codex | `C21_T3=PARTIAL` (details under "Backend T3") |

## Security release gate

| Check | Result |
|---|---|
| `npm ls next postcss` | single `next@16.3.8`; `postcss@8.5.23` (Next and Tailwind) |
| `npm audit --omit=dev` | **0 vulnerabilities** |
| `npm audit` (all) | 9 high, dev/build only: `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces`, and `@opennextjs/cloudflare → @opennextjs/aws → @node-minify/core → glob@10.3.3`. All lockfile entries `dev: true`; none of these packages appear in the Worker bundle. Build-host exposure only. No `audit fix --force` |
| pip-audit (`requirements.lock`) | no known vulnerabilities |
| Secret scan | all 38+ pushed commits: no real `DATABASE_URL`, password, secret key, service-role key or anon key; matches are test fixtures only. Worker bundle: real secret values absent; `sb_secret_` matches are supabase-js prefix checks |
| Previous risk acceptance (expires 2026-11-10) | Superseded: the Next/PostCSS advisories are remediated, not accepted |

Next 16 required source changes (all in `a62d5ac`): ESLint flat config; `revalidateTag("catalog", { expire: 0 })` in `/api/revalidate` (the one-argument form is gone and `"max"` would serve stale content after an admin save); three `setState`-in-effect patterns replaced by render-time adjustment. `middleware.ts` kept (Next 16 warns it is deprecated in favour of `proxy`; `proxy` uses the Node runtime and was not tested with OpenNext).

## Regression on the release tree

| Suite | Result |
|---|---|
| `npm ci` from lockfile | PASS |
| ESLint, TypeScript, Vitest | PASS, PASS, 4/4 |
| Next build, OpenNext build | PASS (all routes `ƒ` except `/_not-found`, `/robots.txt`) |
| Playwright in workerd preview (fixture API), Chromium + WebKit | **34 passed, 14 skipped, 0 failed** (skips: live-write spec and project-specific tests) |
| Visual diff vs Next 15 baseline | 85/85 identical, horizontal overflow 0 |
| Backend ruff, mypy, pytest | PASS, PASS, 66 passed |

## Live verification (read-only)

Backend:
- `/health/live` 200, `/health/ready` 200 (database reachable).
- `/api/v1/site-settings` returns the real `store_name` "Tủ Nhựa Bình Nhâm"; categories 200; products 200 (0 published).
- Anonymous `/admin/dashboard/stats` → 401; malformed bearer → 401 "Invalid or expired access token"; unknown product → 404 "Product not found". No SQL or credentials in errors.
- CORS preflight: the `workers.dev` origin is allowed with credentials; `https://evil.example.com` gets 400 with no `Access-Control-Allow-Origin`.

Frontend:
- `/`, `/san-pham`, `/tin-tuc`, `/lien-he`, `/gioi-thieu`, `/admin/login`, `/sitemap.xml`, `/robots.txt` → 200; unknown product → 404.
- Titles follow the CMS name (`Sản phẩm | Tủ Nhựa Bình Nhâm`, `Đăng nhập quản trị · Tủ Nhựa Bình Nhâm`); `og:site_name` present; sitemap and robots use the `workers.dev` origin.
- `/admin` without a session → `307 /admin/login`, `Cache-Control: private, no-store, max-age=0`.
- First render came from the live API (no build-time API call; every route renders per request).
- Playwright `public.spec.ts` against the live URL: 4/4 (Chromium + WebKit).
- Screenshots: `docs/deployment/screenshots-live/` — 8 pages × 360/390/430/768/1440 × Chromium and WebKit = 80 shots, overflow 0, page errors 0. These are **emulated viewports, not real phones**.

## Backend T3 (Codex, live)

| Check | Result |
|---|---|
| Revision / project | PASS: revision `0004`, fingerprint `cbda20f5bbaa` (read-only catalog query) |
| Public endpoints | PASS: OpenAPI, site-settings, categories, products, posts, banners; expected 404/422; CORS allow/deny |
| Anonymous admin | PASS: every tested admin GET → 401 with `Cache-Control: no-store` |
| Non-admin token → 403 | NOT VERIFIED (no non-admin account available) |
| Error leakage | PASS: no traceback, database URL, password, secret or bearer token in validation, 404, anonymous or bogus-bearer responses |
| Cold start (Render Free) | after exactly 1,200 s idle: `/health/live` **37.65 s** cold, 103 ms warm; `/health/ready` 778 ms then 774 ms |
| Render↔Supabase latency | EXTERNAL ONLY: 20 HTTPS samples of `/health/ready` (`SELECT 1`) from the owner's network: median **1,286 ms**, p95 **2,047 ms**. Includes internet, TLS and Render round trips; database-only latency cannot be isolated without a Render shell or approved in-process timing |
| Log redaction | PARTIAL: responses are redacted; marker `t3-log-redaction-20261013` was sent and the matching sanitized line must be confirmed in the Render dashboard by the owner |

## Owner admin check (live)

The owner signed in on the live site in their own browser (no password shared), reloaded protected pages, opened Admin → Cài đặt without saving, logged out, pressed Back and reopened `/admin`, and reported everything worked. Worker logs for that session (36 requests):
- `/admin`, `/admin/san-pham`, `/admin/san-pham/moi`, `/admin/danh-muc`, `/admin/bai-viet`, `/admin/banner`, `/admin/cai-dat` → 200 (SSR session valid);
- `POST /api/auth/logout` → 200, then `/admin/san-pham` → **307** to the login page;
- no exceptions, no 5xx; `/favicon.ico` → 404 (no favicon set in the CMS and no default file).

Not verified live: that the API rejects the pre-logout access token (unit-tested; the `auth.sessions` read permission was verified read-only in Gate C2.0).

## Worker CPU and bundle

| Metric | Value | Source |
|---|---|---|
| Upload size | 8037 KiB uncompressed / 1637 KiB gzip (limit 64 MiB uncompressed) | `wrangler deploy` |
| Static assets | 46 files | deploy log |
| CPU per request, 24 live SSR requests | `/` 26–66 ms; `/san-pham` 26–235 ms; `/tin-tuc` 19–370 ms; `/lien-he` 20–39 ms; `/gioi-thieu` 30–39 ms; `/admin/login` 23–133 ms; `/sitemap.xml` 8–71 ms | `wrangler tail` `cpuTime` |
| Outcomes | 24/24 `ok`, no `exceededCpu` yet | `wrangler tail` |
| Owner admin session | 36/36 `ok`; max CPU `/admin/login` 268 ms, `/` 129 ms, `/admin/san-pham` 86 ms; client-rendered admin pages 7–13 ms | `wrangler tail` |

Workers Free allows 10 ms CPU per request (error 1102 when enforced). Every SSR request measured above exceeds it, so **Free is not viable for production** even though no request has failed yet. Workers Paid costs **$5/month** minimum (10 M requests and 30 M CPU-ms included, 30 s default CPU limit). The owner chose to keep Free for the preview and to upgrade later; Claude does not upgrade plans.

## Environment variables (names only)

Frontend (build-time, public): `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable key). No Worker secrets.

Backend (Render, `sync: false`, entered by the owner in the Render dashboard): `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWKS_URL`, `CORS_ORIGINS`, `FRONTEND_URL`. Non-secret values are in `render.yaml`.

## Security incident during this gate

A Python `urlsplit` error printed a fragment of the database password in a Claude tool output while checking the URL format. The password contains unencoded special characters. The owner was advised to reset the database password in Supabase (letters and digits only) before entering it in Render, and to update the local `apps/api/.env`. **The owner chose not to rotate it for now and to continue (2026-10-13).** This remains an open risk: rotate before production use, then update Render `DATABASE_URL` and the local `.env`.

## Pending

1. Rotate the database password (open risk, owner deferred).
2. Owner: confirm in the Render dashboard that the log line for marker `t3-log-redaction-20261013` contains no token or secret.
3. Live CMS write tests (save, cache invalidation on the live site): not run; need separate owner approval.
4. Non-admin 403 and live API revocation of a pre-logout token: not verified.
5. Real phone check (S10): not done.
6. Known issue: `/favicon.ico` 404 (set a favicon in Admin → Cài đặt or add a default file).

## Rollback

- Frontend: first deployment, so there is no earlier version to roll back to. Disable the `workers.dev` route in the Worker settings, or delete the Worker `tunhuabinhnham-web` with owner approval. Later releases: `npx wrangler deployments list` then `npx wrangler rollback <version-id>`.
- Backend: Render → service `tunhuabinhnham-api` → Suspend (or roll back to an earlier deploy for later releases). Auto-deploy is off.
- CORS: `CORS_ORIGINS` / `FRONTEND_URL` hold only the `workers.dev` origin; remove it when the preview is retired.
- Database: no migration, no reset; revision `0004` stays. Never run the incident rollback SQL automatically.

## Approvals still required

- Workers Paid ($5/month) before production traffic.
- Render `0.5c-512mb` (~$7/month) to remove Free spin-down.
- Custom domain / DNS cutover.
- Merge to `main`.
- Any live CMS write test.
