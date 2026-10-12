# Render backend deploy plan

This file prepares the temporary Gate C2.1 preview. Committing it does not create a Render service, sync a Blueprint, deploy code, change DNS, or write to the live database. The owner must complete all release gates before creating the service.

## Locked baseline

- Source baseline: `integration/warm-editorial-v2` at `9a19175`, plus the approved Gate C2.1 security commit.
- Live database revision: `0004`. Gate C2.1 adds no migration.
- Blueprint: root `render.yaml`, one Python web service, Singapore region, free plan, source branch `deploy/c2-preview`, one worker, auto-deploy off, no Render Postgres, no disk, and no pre-deploy command.
- Python: `3.11.17`, pinned through the fully qualified `PYTHON_VERSION` environment variable. Python.org lists 3.11.17 as a released security version, and Render accepts any released fully qualified version from 3.7.3 onward.

This plan supersedes the old revision statement in `docs/RENDER_DEPLOYMENT.md`; that file still says revision `0003` is live and must not be used as the Gate C2 source of truth.

## Build and start contract

Render must run the commands already declared in `render.yaml`.

```text
Build: python -m pip install -r apps/api/build-requirements.lock && python -m pip install -r apps/api/requirements.lock && python -m pip install --no-deps ./apps/api
Start: python -m uvicorn app.main:app --app-dir apps/api --host 0.0.0.0 --port $PORT --workers ${WEB_CONCURRENCY:-1}
```

The build uses pinned pip and setuptools versions, then the production dependency lock. One worker keeps the SQLAlchemy pool bounded to three persistent connections plus one overflow connection on the free 512 MB instance.

## Dashboard values the owner must paste

Paste values for exactly these Blueprint prompts. Their values must stay in Render and must not be copied into Git, tickets, chat, screenshots, or command output:

- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_JWT_ISSUER`
- `SUPABASE_JWKS_URL`
- `CORS_ORIGINS`
- `FRONTEND_URL`

Every item above is declared with `sync: false`. Render supplies `PORT`; all other application settings from `app/core/config.py` are explicitly declared in the Blueprint with reviewed non-secret values: `APP_ENV`, `SUPABASE_JWT_AUDIENCE`, `MAX_UPLOAD_BYTES`, `CONTACT_TRACKING_ENABLED`, `DB_POOL_SIZE`, `DB_MAX_OVERFLOW`, `DB_POOL_TIMEOUT_SECONDS`, `DB_CONNECT_TIMEOUT_SECONDS`, `DB_DISABLE_PREPARED_STATEMENTS`, `PUBLIC_CACHE_SECONDS`, and `ADMIN_RATE_LIMIT_PER_MINUTE`. `PYTHON_VERSION` and `WEB_CONCURRENCY` are platform/runtime controls rather than `Settings` fields.

## Health and failure behavior

- `/health/live` proves only that the process can answer HTTP. It does not query dependencies.
- `/health/ready` runs `select 1`. It returns 503 when the database is unavailable and is the Render health-check path.
- Readiness does not test Supabase Auth, Storage, JWT key retrieval, or an active user session. Those checks belong in the post-deploy smoke test.
- Production configuration is validated while the application imports. Missing Supabase credentials, mismatched issuer/JWKS URLs, non-PostgreSQL database URLs, non-HTTPS web origins, and a frontend origin absent from CORS fail startup.
- Unhandled errors return a fixed message and request ID. Database and token material must remain redacted from structured logs.

## Supabase connection mode

Use the exact Shared Pooler session-mode connection string copied from the Supabase Connect dialog. For a persistent Render backend on an IPv4-only network, Supabase documents session mode on port 5432. Keep `DB_DISABLE_PREPARED_STATEMENTS=false`.

Do not infer the pooler hostname from the project region. Do not switch only the port. Transaction mode on port 6543 does not support prepared statements or session state. A later switch requires all of the following before approval:

1. Set `DB_DISABLE_PREPARED_STATEMENTS=true`.
2. Review whether application-side `QueuePool` should become `NullPool` to avoid layered pooling.
3. Run the full API suite and a separate transaction-semantics check.
4. Measure connection and query behavior under the intended concurrency.

## Region decision

Render's current Blueprint reference lists `free` for web services, and its region documentation lists Singapore. Supabase is in `ap-southeast-2` (Sydney). Singapore is therefore the configured free-preview candidate, but region names do not prove latency.

After deployment, first warm the free instance and record repeated HTTPS timings for `/health/live` and `/health/ready`; readiness already executes read-only `select 1`. Those client-side timings measure the entire HTTP path and must not be presented as database latency. A free web service has no Render shell or one-off jobs, so a database-only measurement requires a separately reviewed temporary instrumentation commit that wraps only the existing `select 1` with a monotonic timer and logs the duration, timestamp, and request ID--never the URL, credentials, query parameters, or query result. Collect at least 20 warm samples, record median and tail timings, then remove the instrumentation. If that patch is not approved, report only end-to-end readiness timings and make no Render-to-Supabase latency claim.

## Authentication and CORS

- CORS is an exact comma-separated allowlist of HTTPS origins. Include only hosts that serve the web app; never use `*` with credentials.
- Asymmetric Supabase JWTs require signature, expiry, audience, and issuer validation through JWKS. Each locally verified admin token must also carry `session_id`, and that session must still exist in `auth.sessions`.
- Legacy HS256 tokens are checked through Supabase Auth `/auth/v1/user`, which preserves revocation checking without storing the JWT secret in the API.
- Every admin request still requires an active `admin_users` row with role `admin` or `editor`.

The `auth.sessions` check adds one indexed database lookup for locally verified JWTs. It works through session-mode or transaction-mode pooling because it does not depend on session state. The trade-off is a database round trip and coupling to Supabase's Auth schema; the stricter logout guarantee is intentional.

## Memory and process limits

- Keep `WEB_CONCURRENCY=1` on the free 0.1 CPU, 512 MB instance.
- Keep `DB_POOL_SIZE=3`, `DB_MAX_OVERFLOW=1`, pool timeout 10 seconds, connect timeout 5 seconds, and pool recycle 300 seconds.
- Do not add an in-process worker count or enlarge the pool without memory and connection measurements.
- Uploaded files are capped at 8 MiB, but the endpoint currently reads one file into memory. Watch resident memory during an approved upload smoke test.

## Free-preview limits

- Render documents the free web-service allocation as 0.1 CPU and 512 MB RAM. It is suitable for this temporary preview, not the production capacity decision.
- A free web service spins down after 15 minutes without inbound HTTP or WebSocket traffic and starts again on the next request.
- Measure this service's cold start instead of assigning a predicted duration: allow at least 15 minutes of inactivity, timestamp the first HTTPS request to `/health/live`, record time to the first successful response, then repeat the warm request. Run the same cold/warm pair for `/health/ready`, whose successful response also includes the read-only database check. Record timestamps and all observed durations, and keep cold-start, warm HTTP, and database-only measurements distinct.
- Free services have no persistent disk, shell/SSH access, one-off jobs, multi-instance scaling, or edge caching. The Blueprint deliberately creates none of those resources.

## Pre-deploy evidence required

1. `python -m ruff check apps/api`
2. `python -m mypy apps/api/app`
3. `python -m pytest apps/api/tests -m "not integration_supabase"`
4. API contract and production configuration tests.
5. `pip-audit` against the production lock and tested development environment.
6. `npm audit` and `npm audit --omit=dev`; unresolved findings need a dated risk decision.
7. Secret scan over tracked files and the staged diff.
8. Blueprint schema validation without syncing or creating resources.

Gate C2.1 replaces the temporary Next/PostCSS risk acceptance with Next `16.4.0` (PostCSS `8.5.23`), matching `eslint-config-next 16.4.0`, and `@opennextjs/cloudflare 1.20.10`. The release gate requires the installed production dependency audit to remain free of Moderate, High, and Critical findings.

## Sources

- [Render Python versions](https://render.com/docs/python-version)
- [Python 3.11.17 release](https://www.python.org/downloads/release/python-31117/)
- [Render FastAPI deployment](https://render.com/docs/deploy-fastapi)
- [Render regions](https://render.com/docs/regions)
- [Render Blueprint reference](https://render.com/docs/blueprint-spec)
- [Render free instance limits](https://render.com/docs/free)
- [Render shell compatibility](https://render.com/docs/ssh)
- [Supabase Postgres connections](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase JWTs](https://supabase.com/docs/guides/auth/jwts)

