# Production environment checklist

This file contains the backend half of the Gate C2 environment inventory. It names variables but never records values. The web owner can append the frontend half without changing these controls.

## Render-provided values

- [ ] `PORT` is supplied by Render. The start command binds `0.0.0.0:$PORT`.
- [ ] `RENDER_GIT_COMMIT` is recorded in release evidence when available; it is not copied into application logs as a credential.

## Backend runtime

- [ ] `APP_ENV=production` so fail-fast validation is active.
- [ ] `PYTHON_VERSION` matches the fully qualified version in `render.yaml`.
- [ ] `WEB_CONCURRENCY=1` for the 512 MB plan.
- [ ] `MAX_UPLOAD_BYTES` remains within the reviewed memory budget.
- [ ] `PUBLIC_CACHE_SECONDS` matches the approved public-cache policy.
- [ ] `ADMIN_RATE_LIMIT_PER_MINUTE` matches the single-worker application limit. Edge rate limiting is a separate control.

## Database and pooling

- [ ] `DATABASE_URL` is stored only in Render secret configuration and copied from Supabase's Connect dialog.
- [ ] The URL uses the Shared Pooler session-mode endpoint on port 5432 and TLS; do not derive the hostname.
- [ ] `DB_POOL_SIZE=3` and `DB_MAX_OVERFLOW=1` are compatible with the Supabase connection budget.
- [ ] `DB_POOL_TIMEOUT_SECONDS=10` and `DB_CONNECT_TIMEOUT_SECONDS=5` are set.
- [ ] `DB_DISABLE_PREPARED_STATEMENTS=false` for session mode.
- [ ] A transaction-mode switch is rejected unless prepared statements, application pooling, and transaction semantics are revalidated together.

## Supabase and JWT validation

- [ ] `SUPABASE_URL` is the HTTPS project URL.
- [ ] `SUPABASE_PUBLISHABLE_KEY` is server configuration used for legacy Auth verification; it is not treated as an authorization rule.
- [ ] `SUPABASE_SECRET_KEY` is secret, server-only, and never prefixed `NEXT_PUBLIC_`.
- [ ] `SUPABASE_JWT_ISSUER` equals the project Auth issuer.
- [ ] `SUPABASE_JWKS_URL` equals the issuer plus `/.well-known/jwks.json`.
- [ ] `SUPABASE_JWT_AUDIENCE=authenticated` unless the project's token audience is deliberately changed and retested.
- [ ] Asymmetric tokens include `session_id`; revoked sessions return 401.
- [ ] Legacy HS256 tokens are checked through `/auth/v1/user`; no JWT secret is stored in the API.

## Web boundary

- [ ] `FRONTEND_URL` is one exact HTTPS origin without a path, query, fragment, or credentials.
- [ ] `CORS_ORIGINS` contains `FRONTEND_URL` and only exact deployed HTTPS origins.
- [ ] No wildcard, localhost, preview host, trailing path, or unapproved `www` alias is present in production.
- [ ] Allowed and disallowed preflight requests are retested after the real domain is known.

## Operator checks without value disclosure

- [ ] Compare variable names against `render.yaml`; do not paste values into tickets, chat, screenshots, or logs.
- [ ] Start the application in a controlled environment and confirm configuration validation succeeds.
- [ ] Confirm `/health/live` returns 200 and `/health/ready` reflects database availability.
- [ ] Confirm a valid active admin session returns 200, a revoked session returns 401, and a non-admin returns 403.
- [ ] Confirm structured logs redact Bearer tokens, JWTs, Supabase secret keys, and database passwords.

