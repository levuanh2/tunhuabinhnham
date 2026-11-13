# tunhuabinhnham-render-keepalive

Standalone Cloudflare Worker (cron only, no URL) that sends `GET /health/live` to the Render Free
backend `https://tunhuabinhnham-api.onrender.com`. `/health/live` does not touch the database.
It is independent of the frontend Worker `tunhuabinhnham-web`.

Schedule (UTC; Vietnam = UTC+7), 73 pings/day, 15-minute mode (owner-approved 2026-11-13; was 10-min from 2026-11-07):

| Cron (UTC)        | Vietnam time                       |
| ----------------- | ---------------------------------- |
| `*/15 0-17 * * *` | 07:00, 07:15 … 00:30, 00:45        |
| `0 18 * * *`      | 01:00 (last ping until 07:00)      |

Each run makes one request with a 120 s timeout, no retries, and logs one JSON line:
`ts, target, status, outcome (ok | http_429 | http_4xx | http_5xx | timeout | network_error), durationMs, cron`.
A failed ping also logs safe response headers and `alert`, then **fails the invocation** so Cloudflare
Metrics and Cron Events show it. Incident notes, alerting and troubleshooting: [render-keepalive.md](render-keepalive.md).

Commands (run from the repo root):

```sh
node apps/render-keepalive/check.mjs                                          # offline check
npx wrangler deploy -c apps/render-keepalive/wrangler.jsonc                    # deploy / redeploy
npx wrangler tail tunhuabinhnham-render-keepalive --format pretty               # live logs
```

**Pause:** set `"crons": []` in `wrangler.jsonc` and redeploy; the Worker stays but never runs.
**Delete:** `npx wrangler delete tunhuabinhnham-render-keepalive`.

**Rollback to 30-minute mode:** change the first cron to `0,30 0-17 * * *`, keep `0 18 * * *`, and
redeploy (37 pings/day). Render then sleeps between some pings (cold start about 26 s observed).
