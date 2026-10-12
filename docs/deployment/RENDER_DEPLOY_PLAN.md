# Render backend deploy plan

This is a pre-deployment plan only. Gate C2 does not create a Render service, sync a Blueprint, deploy code, change DNS, or write to the live database.

## Locked baseline

- Source baseline: `integration/warm-editorial-v2` at `4f31346` plus approved Gate C2 commits.
- Live database revision: `0004`. Gate C2 adds no migration.
- Blueprint: root `render.yaml`, one Python web service, Singapore region, `0.5c-512mb`, one worker, auto-deploy off, no Render Postgres, no disk, and no pre-deploy command.
- Python: `3.11.17`, pinned through the fully qualified `PYTHON_VERSION` environment variable.

This plan supersedes the old revision statement in `docs/RENDER_DEPLOYMENT.md`; that file still says revision `0003` is live and must not be used as the Gate C2 source of truth.

## Build and start contract

Render must run the commands already declared in `render.yaml`.

```text
Build: python -m pip install -r apps/api/build-requirements.lock && python -m pip install -r apps/api/requirements.lock && python -m pip install --no-deps ./apps/api
Start: python -m uvicorn app.main:app --app-dir apps/api --host 0.0.0.0 --port $PORT --workers ${WEB_CONCURRENCY:-1}
```

The build uses pinned pip and setuptools versions, then the production dependency lock. One worker keeps the SQLAlchemy pool bounded to three persistent connections plus one overflow connection on the 512 MB plan.

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

Render currently offers Oregon, Ohio, Virginia, Frankfurt, and Singapore. Supabase is in `ap-southeast-2` (Sydney). Singapore is the configured candidate, but region names do not prove latency.

Before deployment approval, measure from a disposable Render service or approved equivalent:

- TCP/TLS connection establishment to the exact Supabase pooler endpoint;
- repeated read-only `select 1` timings after warm-up;
- representative public read and authenticated admin-read timings;
- pool checkout time and timeout count under expected concurrency.

Record median and tail timings with timestamps. Do not claim a latency result until those measurements exist.

## Authentication and CORS

- CORS is an exact comma-separated allowlist of HTTPS origins. Include only hosts that serve the web app; never use `*` with credentials.
- Asymmetric Supabase JWTs require signature, expiry, audience, and issuer validation through JWKS. Each locally verified admin token must also carry `session_id`, and that session must still exist in `auth.sessions`.
- Legacy HS256 tokens are checked through Supabase Auth `/auth/v1/user`, which preserves revocation checking without storing the JWT secret in the API.
- Every admin request still requires an active `admin_users` row with role `admin` or `editor`.

The `auth.sessions` check adds one indexed database lookup for locally verified JWTs. It works through session-mode or transaction-mode pooling because it does not depend on session state. The trade-off is a database round trip and coupling to Supabase's Auth schema; the stricter logout guarantee is intentional.

## Memory and process limits

- Keep `WEB_CONCURRENCY=1` on the 512 MB plan.
- Keep `DB_POOL_SIZE=3`, `DB_MAX_OVERFLOW=1`, pool timeout 10 seconds, connect timeout 5 seconds, and pool recycle 300 seconds.
- Do not add an in-process worker count or enlarge the pool without memory and connection measurements.
- Uploaded files are capped at 8 MiB, but the endpoint currently reads one file into memory. Watch resident memory during an approved upload smoke test.

## Pre-deploy evidence required

1. `python -m ruff check apps/api`
2. `python -m mypy apps/api/app`
3. `python -m pytest apps/api/tests -m "not integration_supabase"`
4. API contract and production configuration tests.
5. `pip-audit` against the production lock and tested development environment.
6. `npm audit` and `npm audit --omit=dev`; unresolved findings need a dated risk decision.
7. Secret scan over tracked files and the staged diff.
8. Blueprint schema validation without syncing or creating resources.

The current lock's Next/PostCSS findings have a temporary risk-acceptance deadline of **2026-11-10**. The supported remediation candidate is Next `16.3.8`, its PostCSS `8.5.23`, matching `eslint-config-next 16.3.8`, and existing `@opennextjs/cloudflare 1.20.9`. Do not deploy on or after the deadline without either a clean audited/tested lock or a new explicit owner decision.

## Sources

- [Render Python versions](https://render.com/docs/python-version)
- [Render FastAPI deployment](https://render.com/docs/deploy-fastapi)
- [Render regions](https://render.com/docs/regions)
- [Render Blueprint reference](https://render.com/docs/blueprint-spec)
- [Supabase Postgres connections](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase JWTs](https://supabase.com/docs/guides/auth/jwts)

