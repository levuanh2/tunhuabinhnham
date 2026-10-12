# Gate C3 — Backend security and Render readiness

**Status: PARTIAL — rotate the exposed database credential before closing Gate C3.**

Gate C3 remains PARTIAL until the owner rotates the database credential. The backend is healthy, the separate read-only preflight matches Supabase fingerprint `cbda20f5bbaa` and revision `0004`, and the intended CORS checks pass. No additional credential match was found within the stated repository, scratch-file, and harness-log scan scope. The owner must still inspect Render Logs/Metrics and replay the pre-logout JWT in their browser.

Checked on 2026-10-13 from branch `gate-c3/backend`, based on `198a6e2`. No plan, DNS, database schema, or Supabase data was changed.

## Gate C3 remains blocked on credential rotation and owner evidence

| Check | Result |
|---|---|
| Known PostgreSQL credential exposure | **OPEN / rotate** |
| Git history and local artifact scan | **PASS within scanned scope** |
| Render logs | **NOT VERIFIED — owner action** |
| Supabase fingerprint / Alembic revision | **PASS — `cbda20f5bbaa` / `0004`** |
| Apex and Workers.dev CORS | **PASS** |
| `www` and hostile-origin rejection | **PASS** |
| Live JWT revocation | **NOT VERIFIED — owner-only replay required** |
| Supabase Sydney connectivity | **PASS** |
| Render memory headroom | **NOT VERIFIED — owner Metrics required** |
| Paid plan change | **NOT PERFORMED** |

## 1. Credential exposure investigation

### The ad-hoc URL check exposed the credential fragment

The exposed fragment came from an ad-hoc Python URL check, not from a backend request handler. The checker passed a raw database URL containing an unencoded special character to `urllib.parse.urlsplit`. For some malformed userinfo values—the username/password portion before the host—Python includes the scheme-less network location, including credential text, in the resulting `ValueError`. The Claude tool output then displayed that exception.

The application does not call `urlsplit` on `DATABASE_URL`. It only normalizes the PostgreSQL driver before SQLAlchemy parses the URL. However, two defense gaps remain:

- the log redactor expects a complete URL and can miss a scheme-less exception fragment or text after an unencoded `@`;
- the SQLAlchemy engine is created before the custom formatter is installed, so a boot-time traceback can reach Render stderr without application redaction.

Routine request logs contain method, path, status, request ID, and duration—not headers, bodies, or environment values. Public readiness and 500 responses also use fixed messages.

### No second local or Git copy was found

The scan compared the exact current URL, the password, and contiguous password fragments of at least eight characters without printing any value. Shorter or non-contiguous fragments and uninspected platform logs are outside this scan's assurance. Synthetic test URLs were distinguished from the real credential.

| Surface | Scope | Exact/fragment matching paths and occurrences |
|---|---|---|
| Reachable Git history | 51 commits | 0 matching paths; 0 exact occurrences |
| Git object store, including unreachable loose objects | 5,548 blobs up to 5 MiB | 0 matching blobs; 0 exact occurrences |
| Workspace | 4,488 files up to 10 MiB, excluding dependency/build caches | `apps/api/.env`: 1 expected ignored matching path, 1 exact occurrence; all other paths: 0 |
| External harness backups | 51 `*.log` files plus related artifacts | 0 matching paths; 0 exact or fragment occurrences |
| Recent temp/Claude/pytest scratch | 14,036 files modified since 2026-10-11 | 0 matching paths; 0 exact or ten-character fragment occurrences |
| PowerShell history | current local history | 0 matching paths; 0 exact or fragment occurrences |
| Known Claude tool output | Provided incident record | non-filesystem transcript / 1 known fragment exposure |
| Render build/runtime/deploy logs | No Dashboard or API access | **NOT INSPECTED** |

The repository ignores `.env`, `.env.*`, `*.log`, and `backups/`.

The live E2E harness redacts rendered commands, but child API stdout/stderr can be retained at `E:\Tunhuabinhnham-backups\<run-id>\logs\api.log`; those retained logs were included in the scan. Test-only dummy URLs occur in `apps/api/tests/test_logging.py` and `apps/api/tests/test_security_validation.py`; they do not match the live credential.

### Owner rotation runbook

1. Schedule a short maintenance window. Record only the current Render deploy ID/commit and environment-variable names. Do not copy the old URL or password into chat, notes, screenshots, or shell history.
2. In **Supabase Dashboard → Database → Settings**, reset the database password. Prefer a password-manager-generated, high-entropy value containing only letters and digits at this URI boundary. If reserved characters are used, percent-encode the **password component only** before placing it in a URL.
3. Open **Supabase Dashboard → Connect** and copy the exact Shared/Session Pooler URL. Do not infer its host, user, region, or port. Use the documented session endpoint and TLS settings.
4. In Render, replace only `DATABASE_URL`, save it, and deploy the current known-good code. An ordinary restart before redeploy does not apply an unsaved/new environment value. Do not change the plan, DNS, or any other variable.
5. Against `https://tunhuabinhnham-api.onrender.com`, verify `GET /health/live` returns 200, followed by `GET /health/ready` returning 200.
6. Update local `apps/api/.env` without echoing or displaying it, then restart local API processes. Run the read-only `apps/api/scripts/preflight_live_supabase.py` and confirm fingerprint `cbda20f5bbaa` and exactly revision `0004`.
7. If the opt-in GitHub Supabase workflow is used, update its `SUPABASE_DATABASE_URL` repository secret.
8. Perform the Render log review below. Share only match counts, timestamps, and sanitized lines—never a URL, credential, bearer token, or JWT.

If readiness fails after rotation:

1. Suspend the Render service to stop connection retries.
2. Recheck the exact Dashboard-provided endpoint and password-component encoding offline.
3. If uncertain, reset again to a fresh alphanumeric value.
4. Update Render and local `.env`, redeploy, and repeat the health and read-only preflight checks.

Never restore the old credential or change revision `0004`; do not migrate, downgrade, reset, or seed. [Render rollback](https://render.com/docs/rollbacks) can reuse the target deploy's environment variables, so only a post-rotation deploy is a safe rollback target. If an older artifact must be restored, reapply the rotated `DATABASE_URL`, redeploy, and repeat verification immediately.

Supabase documents password reset in Database Settings and percent-encoding reserved URL characters in its [password troubleshooting](https://supabase.com/docs/guides/troubleshooting/fatal-password-authentication-failed) and [connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres).

## 2. Live CORS verification

Each origin was tested against the live Render backend with:

- an `OPTIONS` preflight requesting `GET` and the `Authorization` header; and
- a simple `GET /api/v1/site-settings` with an `Origin` header.

| Origin | Preflight | Simple GET | Browser decision |
|---|---:|---:|---|
| `https://tunhuabinhnham.com` | 200; exact ACAO; credentials allowed | 200; exact ACAO | Allowed |
| `https://tunhuabinhnham-web.tunhuabinhnham.workers.dev` | 200; exact ACAO; credentials allowed | 200; exact ACAO | Allowed |
| `https://www.tunhuabinhnham.com` | 400; no ACAO | 200; no ACAO | Blocked |
| `https://evil.example.com` | 400; no ACAO | 200; no ACAO | Blocked |

A simple cross-origin GET can still receive HTTP 200 at the server. The absence of `Access-Control-Allow-Origin` is the expected denial that prevents browser JavaScript from reading it. `www` is therefore not an allowed application origin; this report does not request or make any DNS change.

CORS is a browser read boundary, not authentication and not protection from non-browser callers.

## 3. JWT logout revocation still needs an owner-side replay

**Live status: NOT VERIFIED.** Verifying revocation requires replaying the exact pre-logout token after the owner logs out. The owner does not need to share that token:

1. Sign in normally and open an admin view that makes a protected backend request; confirm it returns 200.
2. In browser DevTools Network, enable **Preserve log** and retain that exact successful request.
3. Log out and wait for the logout request to finish.
4. Use DevTools **Replay XHR/Resend** on the preserved pre-logout request, locally in the owner's browser. Do not copy its Authorization header into chat, a ticket, or a screenshot. If the browser has no safe replay action, leave this check NOT VERIFIED.
5. Confirm the replay timestamp is after logout and the response is 401. A new request without the old token is not sufficient evidence.

For asymmetric JWTs, the backend validates claims and checks that the session ID still exists in Supabase `auth.sessions`, so deletion of that session should make replay return 401. The legacy HS256 path accepts Supabase Auth's `/auth/v1/user` result and does not perform the same database session check; [Supabase notes](https://supabase.com/docs/guides/auth/signout) that revoked-session access tokens can otherwise remain valid until expiry. Immediate live revocation therefore remains NOT VERIFIED until the owner-side replay succeeds.

## 4. Owner must inspect Render logs for startup-time leakage

The owner should inspect **Render Dashboard → service → Logs/Events** across the original failure, every failed boot, and the rotation redeploy window. Search for these labels, not for the secret itself:

- `Traceback`, `ValueError`, `netloc`, `DATABASE_URL`;
- `postgresql`, `psycopg`, `sqlalchemy`, `OperationalError`;
- `password`, `Authorization`, `Bearer`, and JWT-shaped text;
- the time window and request identifiers associated with the prior marker test `t3-log-redaction-20261013`.

Confirm that no full or partial database URL, user-info fragment, password fragment, Supabase server secret, bearer/JWT, or traceback input value appears in build, deploy, or runtime logs. The literal marker must have zero log matches because request logs never record Authorization values; locate the corresponding 401 by timestamp, path, or request ID and confirm that it contains only structured request fields. Record counts and timestamps; if a line must be shared, sanitize it locally first. Because boot failures can occur before the custom formatter is installed, a clean application-log sample alone is not enough.

## 5. Render and Supabase runtime checks

### External timings do not isolate Render-to-Supabase latency

The most recent controlled Free-tier cold-start measurement remains:

- `/health/live`: 37.65 s after a verified 20-minute idle period;
- immediate warm `/health/live`: 103 ms;
- the next two `/health/ready` calls: 778 ms and 774 ms.

A current warm run after the CORS checks produced ten 200 responses per endpoint:

| Endpoint | Median | Min–max | p95 nearest-rank |
|---|---:|---:|---:|
| `/health/live` | 325.9 ms | 256.6–457.9 ms | 457.9 ms |
| `/health/ready` | 1,036.2 ms | 985.2–1,515.9 ms | 1,515.9 ms |

These client-side timings include internet, TLS, and Render ingress round trips. `/health/ready` also includes a `select 1`, but subtracting `/health/live` does not produce a reliable Render-to-Supabase latency. A new controlled cold window was not forced while the public Worker/domain was active; the earlier controlled measurement is the valid cold reference. Isolating Render→Supabase requires a Render-shell measurement or an approved in-process timing metric.

### Sydney connectivity and database identity

The live `/health/ready` responses prove that the Singapore Render service can reach its configured database and complete `select 1`. A separate local read-only preflight completed against the intended Sydney Supabase project and confirmed:

- project-reference fingerprint: `cbda20f5bbaa`;
- Alembic revision: exactly `0004`;
- no missing baseline tables, expected indexes, or RLS coverage.

No migration or data write was run. The public readiness response does not expose database identity or revision, so external checks cannot cryptographically bind Render's live `DATABASE_URL` to that project; owner-side Render configuration review is needed for that final binding.

### Memory: owner Metrics reading

In **Render Dashboard → service → Metrics**, select a window covering a cold start and representative admin/public traffic. Record:

- memory working set in MB, steady baseline, and peak;
- peak as a percentage of the 512 MB limit;
- CPU baseline and peak percentage at the same timestamps;
- any OOM, restart, or crash event in Logs/Events;
- timestamps and instance/deploy ID.

Leave at least 20% memory headroom as an operational review target; repeated peaks above roughly 80%, growth that does not settle after traffic, or any OOM/restart needs investigation. Render's [service metrics documentation](https://render.com/docs/service-metrics) notes that CPU and memory are available in the Dashboard, while response-latency percentiles require a Pro workspace.

### Starter removes spin-down and adds CPU, but not memory

Render's current official material lists Starter `0.5c-512mb` at **US$7/month per instance**; confirm the checkout price in the owner Dashboard before any future purchase. The plan provides 0.5 CPU and 512 MB RAM, compared with Free's 0.1 CPU and 512 MB RAM. Sources: [Render compute plans](https://render.com/docs/compute-plans) and its [current production hosting guide](https://render.com/articles/production-rails-hosting-guide).

It would remove [Free-tier idle spin-down and the no-shell limitation](https://render.com/docs/free), and provide five times the stated CPU allocation. That should reduce cold-start exposure and CPU contention, while shell access would permit a direct Render-side latency measurement. It does **not** add memory, change Singapore↔Sydney network distance, fix credential encoding/redaction, alter JWT/CORS behavior, or guarantee database latency. No paid service was created or selected.

## 6. Rollback boundaries

- For credential failure: suspend the Render service, correct/reset the credential, and redeploy. Never restore the compromised password.
- For a code-only regression: suspend the service or roll back only to a post-rotation deploy. Render rollback can restore the target deploy's environment variables; when selecting an older artifact, reapply the rotated `DATABASE_URL` and redeploy before verification. It does not undo Supabase state.
- Do not merge to `main`, change DNS, purchase a plan, run Alembic downgrade/migration, or modify live Supabase data as part of this gate.

## Five owner checks remain before Gate C3 can pass

Gate C3 can move from PARTIAL after the owner records:

1. database password reset and successful Render/local URL update;
2. post-rotation `/health/ready` 200 plus fingerprint `cbda20f5bbaa` and revision `0004`;
3. sanitized Render log-search counts with no secret exposure;
4. post-logout replay of the old JWT returning 401;
5. Render memory/CPU readings and confirmation of no OOM/restart.
