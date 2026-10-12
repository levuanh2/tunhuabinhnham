# Environment checklist

**No secret values in this file.** It lists only names, where each variable is set, and whether it is secret. The values live in the platform dashboards (Render, Cloudflare build environment) and in the owner's password manager.

## Frontend: Cloudflare Worker (owner: Claude)

All web variables are `NEXT_PUBLIC_*`. They are **inlined at build time** (`npm --workspace apps/web run build:cloudflare`), so changing one requires a rebuild and redeploy. The Worker needs **no runtime secrets and no Wrangler secrets**.

| Variable | Secret? | Temporary-URL phase | After custom-domain cutover | Used by |
|---|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | no | `https://<render-service>.onrender.com/api/v1` | `https://api.<domain>/api/v1` (optional) | `lib/api.ts`, `lib/admin-api.ts`, `/api/revalidate` |
| `NEXT_PUBLIC_SITE_URL` | no | `https://tunhuabinhnham-web.<account-subdomain>.workers.dev` | `https://<domain>` | `metadataBase`, canonical/OG, `sitemap.xml`, `robots.txt` |
| `NEXT_PUBLIC_SUPABASE_URL` | no | `https://fyaourksnjeldsvuedox.supabase.co` | same | browser Supabase client, middleware, logout route |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`) | no (public by design, RLS-protected) | project publishable key | same | browser client, middleware, logout route |

Never put any of these in a `NEXT_PUBLIC_*` variable: `SUPABASE_SERVICE_ROLE_KEY` / secret key, `DATABASE_URL`, JWT secret.

Before every frontend build:
- [ ] `NEXT_PUBLIC_API_URL` points at the **public HTTPS** API (`global_fetch_strictly_public` blocks private addresses).
- [ ] `NEXT_PUBLIC_SITE_URL` equals the origin the site will be served from. A wrong value shows up in canonical tags and the sitemap.
- [ ] The build log has no `localhost` API URL: `grep -r "localhost:8" .open-next/ || echo clean`.
- [ ] The client bundle has no server secret: search `.open-next/assets` for `service_role`, `sb_secret_` and `postgresql://`. Expect no matches.

Cross-service settings that must change together with `NEXT_PUBLIC_SITE_URL`:
- [ ] Render API `FRONTEND_URL` equals the exact web origin (scheme + host, no trailing slash) and `CORS_ORIGINS` contains it. The API refuses to start in production otherwise.
- [ ] Supabase → Authentication → URL Configuration → Redirect URLs contains the web origin (needed for password-reset links).

## Backend: Render web service (owner: Codex)

This file contains the backend half of the Gate C2 environment inventory. It names variables but never records values. The web owner can append the frontend half without changing these controls.

### Render-provided values

- [ ] `PORT` is supplied by Render. The start command binds `0.0.0.0:$PORT`.
- [ ] `RENDER_GIT_COMMIT` is recorded in release evidence when available; it is not copied into application logs as a credential.

### Backend runtime

- [ ] `APP_ENV=production` so fail-fast validation is active.
- [ ] `PYTHON_VERSION` matches the fully qualified version in `render.yaml`.
- [ ] `WEB_CONCURRENCY=1` for the 512 MB plan.
- [ ] `MAX_UPLOAD_BYTES` remains within the reviewed memory budget.
- [ ] `PUBLIC_CACHE_SECONDS` matches the approved public-cache policy.
- [ ] `ADMIN_RATE_LIMIT_PER_MINUTE` matches the single-worker application limit. Edge rate limiting is a separate control.

### Database and pooling

- [ ] `DATABASE_URL` is stored only in Render secret configuration and copied from Supabase's Connect dialog.
- [ ] The URL uses the Shared Pooler session-mode endpoint on port 5432 and TLS; do not derive the hostname.
- [ ] `DB_POOL_SIZE=3` and `DB_MAX_OVERFLOW=1` are compatible with the Supabase connection budget.
- [ ] `DB_POOL_TIMEOUT_SECONDS=10` and `DB_CONNECT_TIMEOUT_SECONDS=5` are set.
- [ ] `DB_DISABLE_PREPARED_STATEMENTS=false` for session mode.
- [ ] A transaction-mode switch is rejected unless prepared statements, application pooling, and transaction semantics are revalidated together.

### Supabase and JWT validation

- [ ] `SUPABASE_URL` is the HTTPS project URL.
- [ ] `SUPABASE_PUBLISHABLE_KEY` is server configuration used for legacy Auth verification; it is not treated as an authorization rule.
- [ ] `SUPABASE_SECRET_KEY` is secret, server-only, and never prefixed `NEXT_PUBLIC_`.
- [ ] `SUPABASE_JWT_ISSUER` equals the project Auth issuer.
- [ ] `SUPABASE_JWKS_URL` equals the issuer plus `/.well-known/jwks.json`.
- [ ] `SUPABASE_JWT_AUDIENCE=authenticated` unless the project's token audience is deliberately changed and retested.
- [ ] Asymmetric tokens include `session_id`; revoked sessions return 401.
- [ ] Legacy HS256 tokens are checked through `/auth/v1/user`; no JWT secret is stored in the API.

### Web boundary

- [ ] `FRONTEND_URL` is one exact HTTPS origin without a path, query, fragment, or credentials.
- [ ] `CORS_ORIGINS` contains `FRONTEND_URL` and only exact deployed HTTPS origins.
- [ ] No wildcard, localhost, preview host, trailing path, or unapproved `www` alias is present in production.
- [ ] Allowed and disallowed preflight requests are retested after the real domain is known.

### Operator checks without value disclosure

- [ ] Compare variable names against `render.yaml`; do not paste values into tickets, chat, screenshots, or logs.
- [ ] Start the application in a controlled environment and confirm configuration validation succeeds.
- [ ] Confirm `/health/live` returns 200 and `/health/ready` reflects database availability.
- [ ] Confirm a valid active admin session returns 200, a revoked session returns 401, and a non-admin returns 403.
- [ ] Confirm structured logs redact Bearer tokens, JWTs, Supabase secret keys, and database passwords.

