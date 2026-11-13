# Render keep-alive: operations and incident log

Worker: `tunhuabinhnham-render-keepalive` (cron only, no route, no credentials).
Target: `GET https://tunhuabinhnham-api.onrender.com/health/live`, 120 s timeout, 0 retries.
Crons (UTC; Vietnam = UTC+7): `15,45 0-17 * * *` (07:15–00:45 VN; GitHub Actions covers :00/:30) and `0 18 * * *` (01:00 VN).
Triggers fire about 50 s after the minute.

## Failure detection (version 60cf688d, 2026-11-08)

Deployed 2026-11-08 06:18:40Z at 100%, crons unchanged. First real run 06:20:50Z (13:20 VN): HTTP 200,
211 ms, `outcome ok`. The failure path is covered by `node apps/render-keepalive/check.mjs` only; no
fake 429 was sent to production.

| Response | `outcome` | Invocation |
| --- | --- | --- |
| HTTP 200–299 | `ok` | success |
| HTTP 429 | `http_429` | **failed** |
| other HTTP 4xx | `http_4xx` | **failed** |
| HTTP 5xx | `http_5xx` | **failed** |
| no response within 120 s | `timeout` | **failed** |
| DNS / TLS / connect error | `network_error` | **failed** |

Each run logs one JSON line (`ts, target, status, outcome, durationMs, cron`). A failed run also logs:

- `headers`: only `server`, `rndr-id`, `x-render-origin-server`, `retry-after`, `cf-ray`, `content-type`.
  No cookies, auth headers, keys, webhook URL or response body.
- `source` / `confidence`: `origin_app` / `probable` when `x-render-origin-server` is present (uvicorn
  answered). In every other case `unknown` / `unknown`, because a missing header proves nothing.
  `confirmed` requires matching `ts` / `cf-ray` against the Render request logs by hand.
- `alert`: `disabled` or `pending` (webhook result logged on the next line as `sent` / `failed_*`).

Then `scheduled()` throws, so the invocation shows as an error in Worker Metrics and Cron Events.
Cron Triggers do not retry a failed invocation, so a failure costs exactly one extra log line.

### Webhook alert (optional, currently DISABLED)

Set the secret only with the owner's webhook (Discord or Slack-style JSON):

```sh
npx wrangler secret put ALERT_WEBHOOK_URL -c apps/render-keepalive/wrangler.jsonc   # enable
npx wrangler secret delete ALERT_WEBHOOK_URL -c apps/render-keepalive/wrangler.jsonc # disable
```

One POST per failed run, 5 s timeout, no retry, at most one per cron run (≤ 109/day). The payload is a
one-line summary (`outcome`, `status`, `ts`, `durationMs`). A failing webhook never hides the ping failure.

## Where to look

- Worker Metrics: Dashboard → Workers & Pages → `tunhuabinhnham-render-keepalive` → Metrics
  (errors, wall time, subrequests by status).
- Cron Events: same Worker → Settings → Triggers → Cron Events (past runs and their outcome).
- Logs: Worker → Observability / Logs, or live: `npx wrangler tail tunhuabinhnham-render-keepalive --format pretty`.
- Per-request status without the dashboard: Cloudflare GraphQL dataset `workersSubrequestsAdaptiveGroups`
  (fields `httpResponseStatus`, `requestOutcome`, `coloCode`). A timed-out ping shows as `status 0`,
  `requestOutcome notDone`, wall time about 120 s.

## Incident 2026-11-08: backend unavailable all morning

Verdict: `KEEPALIVE_RAN_BACKEND_UNHEALTHY`. The keep-alive ran on schedule; the backend did not serve.

Timeline (Vietnam time):

| Time | Event |
| --- | --- |
| 01:00:05 | Last successful ping (HTTP 200). Overnight gap 01:00–07:00 is by design. |
| 06:15 | Web Worker `tunhuabinhnham-web` already gets HTTP 429 from the API (before any keep-alive ping). |
| 07:10–12:50 | Every keep-alive ping fails: **11× HTTP 429** (answered in 0.18–0.79 s) and **24× timeout** (no response in 120 s). |
| 07:00–12:59 | Web Worker sees 429, Cloudflare **524** (origin timeout ~125 s) and unfinished requests. |
| 12:30:50 | timeout · 12:40:50 HTTP 429 · 12:50:50 timeout |
| 12:57 | Owner sees the site is slow. |
| 12:58:52–13:00:13 | Owner's manual Render deploy. |
| 13:00:50 | Ping HTTP 200 in 0.18 s; Render log shows `GET /health/live 200` at 13:00:51. |

The 429s came at 07:20, 08:30, 09:20, 09:40, 10:10, 10:40, 10:50, 11:00, 11:20, 11:30 and 12:40.

Verified:

- All 35 failures came from version `3a72ed45`; Metrics showed 2xx 9 / 4xx 11, and the 24 timeouts have no status.
- The 120 s wall time is the Worker's own `AbortSignal.timeout(120000)`, not a Cloudflare limit.
- FastAPI has no rate limiter on `/health/live`, so the 429 was not produced by the app's code.
- Version 3a72ed45 reported `success` for every failed ping, so no metric or alert fired. Fixed in 60cf688d.

Not determined:

- Which layer in front of uvicorn (Render edge/proxy) returned the 429, and why. No response headers
  were logged at the time.
- Why the instance did not come up after the overnight sleep until a manual deploy (needs Render Events).
- Two cron slots (00:10 VN on 11-08 and 07:00 VN) have no invocation in analytics.

## Next incident runbook

1. Read the failing log line: `outcome`, `status`, `headers`, `source`.
2. If `http_429` or `timeout` repeats for 2+ runs, open Render → service → Events and Logs for the same
   minutes. If Render logs show no `/health/live` line at that time, the request never reached the app.
3. Recovery is a manual owner decision (Render manual deploy or restart). The Worker never restarts the backend.
4. Record timestamps, `cf-ray`, `rndr-id` and the Render event in this file.

## Rollback

- Code rollback to the previous version (loses failure detection):
  `npx wrangler rollback 3a72ed45-0b3a-4b58-9b29-c9dd12eb1162 --name tunhuabinhnham-render-keepalive`
  (crons are not changed by a rollback).
- Scheduler back to 30-minute mode: set the first cron to `0,30 0-17 * * *`, keep `0 18 * * *`, redeploy.
- Pause: `"crons": []`, redeploy.
