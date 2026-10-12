# Cloudflare Workers deploy plan (frontend)

Owner: Claude (frontend). Status: **prepared, not executed.** No Cloudflare resource has been created, and no `wrangler login` or `deploy` has been run.

Branch `gate-c2/web`. Measured on 2026-10-12.

## Architecture (unchanged)

Next.js App Router built by OpenNext into one Worker plus static assets. We are not migrating to vinext.

| Item | Value | Source |
|---|---|---|
| Next.js | 15.5.27 | `node_modules` |
| `@opennextjs/cloudflare` | 1.20.9 | `node_modules` |
| Wrangler | 4.149.0 | `npx wrangler --version` |
| Worker name | `tunhuabinhnham-web` | `apps/web/wrangler.jsonc` |
| `compatibility_date` | `2026-10-10` | `wrangler.jsonc` |
| `compatibility_flags` | `nodejs_compat`, `global_fetch_strictly_public` | `wrangler.jsonc` |
| Bindings | `ASSETS` (static assets), `WORKER_SELF_REFERENCE` (service binding to itself; name must match the Worker name), `IMAGES` (Cloudflare Images for `next/image`) | `wrangler dry-run` |
| Observability | `observability.enabled = true` (Workers Logs) | `wrangler.jsonc` |
| OpenNext caches | default (dummy) incremental cache, tag cache and queue; **no R2, D1 or Durable Objects** | `open-next.config.ts` |

`global_fetch_strictly_public` lets the Worker fetch public addresses only. The API must therefore be a public HTTPS URL, such as Render's `*.onrender.com`. A private IP, or `localhost`, will not work in production.

## Measured locally

| Check | Result |
|---|---|
| `opennextjs-cloudflare build` | PASS |
| Bundle (`wrangler deploy --dry-run`, no upload) | Total upload **6609.30 KiB**, gzip **1322.17 KiB**. OpenNext docs give a limit of 3 MiB (Free) / 10 MiB (Paid) compressed. Cloudflare's limits page now says only the uncompressed size counts (64 MiB). Either way, it fits |
| Static assets | 98 files, 1.8 MiB |
| Full fixture Playwright suite **inside `wrangler` local preview (workerd)** | **34 passed, 14 skipped**, 0 failed. Covers: responsive 320–1440, Vietnamese fonts, CMS store rename with immediate public update, product/article SEO, admin login error, logout with Back button and replay of pre-logout cookies, product save round-trip, draft/publish |
| Preview request log | 1577 GET 200, 4 POST 200, 2 GET 307; **no 4xx or 5xx** |
| Admin middleware without a session | `307 → /admin/login`, `Cache-Control: private, no-store, max-age=0` |
| `sitemap.xml`, `robots.txt` | 200, generated at request time |

## Rendering and cache strategy (decision for Gate C2.0)

The problem, measured in wrangler preview: with the dummy cache, OpenNext renders every request. This had two effects:
- Content was never stale: a CMS name change showed immediately.
- When the API was down, pages still returned `200` with fallback content.

Under `next start` (Node), the same code prerendered `/`, `/tin-tuc`, `/lien-he`, `/gioi-thieu` and `sitemap.xml` at **build time**. A build that could not reach the API baked fallback or empty content into those pages for up to 60 s and beyond.

The fix (`87966fc`):
- `(public)/layout.tsx`, the admin layouts and `sitemap.ts` call `connection()`, so every route renders at request time (`ƒ` in the build table). The build no longer fetches the API.
- API reads keep `next: { revalidate: 60, tags: ["catalog"] }`. Admin saves call `/api/revalidate`, which verifies the admin's bearer token against the API and then runs `revalidateTag("catalog")` + `revalidatePath("/", "layout")`. This is explicit invalidation.
- Behaviour on Workers with dummy caches: every page view fetches the API (about 5 calls on `/`). Freshness is immediate, and the API carries the load.
- **Optional later step (needs owner approval, creates resources):** an R2 incremental cache plus a `D1NextModeTagCache` and a Durable Object queue, as the OpenNext caching guide recommends for small sites. This restores the Data Cache across requests while keeping on-demand invalidation. It is not needed for launch at the expected traffic.

Not done: returning 503 instead of a degraded 200 when the API is fully down. This is a runtime-outage behaviour, not a post-deploy staleness issue. It is listed under risks.

## Build-time vs runtime variables

Every variable the web app reads is `NEXT_PUBLIC_*`. These are **inlined at build time**, so changing any of them needs a rebuild and redeploy. The Worker holds **no server secrets**. See `ENVIRONMENT_CHECKLIST.md` for the full list.

| Variable | Temporary-URL phase | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://<render-service>.onrender.com/api/v1` | Must be public HTTPS (because of `global_fetch_strictly_public`) |
| `NEXT_PUBLIC_SITE_URL` | `https://tunhuabinhnham-web.<account-subdomain>.workers.dev` | Drives `metadataBase`, canonical/OG URLs, `sitemap.xml` and `robots.txt` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://fyaourksnjeldsvuedox.supabase.co` | Public |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`) | the project's publishable key | Public by design; RLS protects the data |

## Supabase SSR cookies and auth on Workers

- Login runs in the browser through `supabase-js`. SSR session refresh happens in `middleware.ts`, which runs in the Worker and calls `supabase.auth.getUser()` against Supabase Auth. A revoked session is therefore rejected server-side.
- Logout goes through `POST /api/auth/logout`. It checks the same origin, calls server `signOut()`, expires the `sb-*-auth-token` cookies, then calls `window.location.replace("/admin/login")`.
- On `https://*.workers.dev`, `@supabase/ssr` sets cookies `Secure`; locally they are not. **Not yet verified on a real HTTPS origin.** This is smoke test S6 below.
- Supabase Dashboard → Authentication → URL Configuration: add the `workers.dev` URL (and later the custom domain) to the **Redirect URLs** so password-reset links work. Password login itself does not need it.

## Images

- `next/image` uses the `IMAGES` binding on Workers. Remote images are allowed only from `**.supabase.co/storage/v1/object/public/**` (`next.config.ts`).
- **Not verified:** a real Supabase Storage image through the binding. The bucket has 0 objects, and the fixture uses `data:` URIs, which skip the optimiser. This is smoke test S8 after the first CMS image upload.
- Cost (Cloudflare Images docs):
  - **Free:** up to **5,000 unique transformations per month**. Beyond that, new transformations return error `9422` (no charge); cached ones keep serving.
  - **Paid:** 5,000 included, then **$0.50 per 1,000** unique transformations per month.

## Plan and cost (no measurement of CPU yet)

| Plan | Price | Requests | CPU per request |
|---|---|---|---|
| Workers Free | $0 | 100,000 per day | **10 ms** |
| Workers Paid | **$5/month minimum per account** | 10 M per month included, then $0.30 per M | up to 5 min (default 30 s); 30 M CPU-ms per month included, then $0.02 per M CPU-ms |

Static asset requests are free and unlimited (Cloudflare pricing page).

**Recommendation: Workers Paid ($5/month).** SSR of these pages on every request is unlikely to fit the 10 ms CPU limit of the Free plan. This is **not measured**: local workerd does not enforce or report per-request CPU. After the first deploy, read *CPU time* in Workers Observability, and only then decide whether Free is viable.

## Staged deployment (frontend part; runs after the backend is healthy)

None of these commands have been run. Each step needs the owner's go-ahead.

```bash
# 0. Owner: authenticate wrangler on this machine (interactive; owner runs it)
npx wrangler login

# 1. From the approved integration commit, with the production public values
cd apps/web
cat > .env.production.local <<'EOF'
NEXT_PUBLIC_API_URL=https://<render-service>.onrender.com/api/v1
NEXT_PUBLIC_SITE_URL=https://tunhuabinhnham-web.<account-subdomain>.workers.dev
NEXT_PUBLIC_SUPABASE_URL=https://fyaourksnjeldsvuedox.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>
EOF
npm --workspace apps/web run build:cloudflare
npx wrangler deploy --dry-run          # confirm bindings and size, no upload

# 2. Deploy to the workers.dev URL (creates the Worker: owner approval required)
npx opennextjs-cloudflare deploy

# 3. Backend: add the workers.dev origin to FRONTEND_ORIGINS on Render, then redeploy the API (Codex plan)
```

`.env.production.local` is git-ignored (`.env.*`). It holds only public values, but it must still not be committed.

## Smoke tests after the first frontend deploy

| # | Check | Pass condition |
|---|---|---|
| S1 | `GET /` | 200; `<title>` = CMS `store_name`; header and footer show the same name |
| S2 | `/san-pham`, `/san-pham/<slug>`, `/tin-tuc`, `/lien-he`, `/gioi-thieu` | 200; `og:site_name`, canonical and `og:url` use the `workers.dev` origin |
| S3 | `/sitemap.xml`, `/robots.txt` | 200; URLs use `NEXT_PUBLIC_SITE_URL` |
| S4 | `/admin` without a session | `307 → /admin/login`, `no-store` |
| S5 | Owner logs in (own browser) | dashboard loads; API CORS has no errors in the console |
| S6 | Reload `/admin/san-pham` | still signed in; `sb-*-auth-token` cookie is `Secure` |
| S7 | Rename a field in Admin → Cài đặt, save, then reload `/` | new value visible immediately |
| S8 | Upload an image in the CMS, open the product page | `/_next/image` 200 through `IMAGES` |
| S9 | Log out, press Back, open `/admin` | login page; no protected content |
| S10 | Phone (real device) on 4G | public pages and the admin drawer usable |
| S11 | Workers Observability | no 5xx; record CPU time per request (input for the Free vs Paid decision) |

## Monitoring and logs

- Workers Logs (observability enabled), plus `npx wrangler tail tunhuabinhnham-web` for live tails.
- Watch for: 5xx, error 1102 (CPU limit), `9422` (Images limit), and API fetch failures, which appear as fallback content.

## Rollback (frontend)

See `ROLLBACK_PLAN.md`. In short: `npx wrangler deployments list`, then `npx wrangler rollback <version-id>`. That redeploys a previous Worker version instantly, without a rebuild. While still on `workers.dev`, there is no DNS to revert.

## Risks

| Risk | Level | Mitigation |
|---|---|---|
| 10 ms CPU limit on Free plan | High if Free is used | Use Workers Paid ($5/month); confirm CPU in observability |
| API down makes pages return degraded 200 (fallback name, empty catalogue) | Medium | Render health checks and alerts; optional 503 handling later |
| Every page view calls the API (no persistent Data Cache with dummy caches) | Medium | Size Render accordingly; optional R2 + D1 cache later |
| `NEXT_PUBLIC_*` inlined at build: wrong values need a rebuild | Low | Build from the checklist; verify S1–S3 |
| Images over 5,000 unique transformations per month on Free | Low | Monitor; Paid Images if needed |
| Next 15.5.27 / PostCSS advisories (ACCEPTED_RISK until 2026-11-10) | See Codex security report | Dependency decision before 2026-11-10 |
