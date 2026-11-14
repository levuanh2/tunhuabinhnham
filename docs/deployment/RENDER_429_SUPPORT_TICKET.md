# Render Support ticket (draft, owner sends after review)

**Subject:** 429 / fast failures for requests from Cloudflare Workers to a Free web service, while other clients get 200

**Service:** `tunhuabinhnham-api` (Free web service, FastAPI/uvicorn), `https://tunhuabinhnham-api.onrender.com`

Hello Render team,

Our public website runs on Cloudflare Workers (zone `tunhuabinhnham.com`) and calls our Render web service for public catalogue data (GET only, a few requests per page view). Since 2026-11-08 the Worker repeatedly receives HTTP 429, or fails within a second, while requests from other networks at the same time receive 200 from our app. As a result, our customers see an error page instead of our products.

## Evidence (all times UTC)

- **2026-11-08 00:10–05:50**
  - A Cloudflare cron Worker pinging `GET /health/live` every 10 min: 11 responses were HTTP 429 in under 1 s, and 24 requests got no response within 120 s.
  - Our web Worker saw 429 and Cloudflare 524 at the same time.
  - It recovered only after we manually redeployed the service (05:58–06:00).
- **2026-11-10:** every path on `tunhuabinhnham-api.onrender.com` returned `HTTP/1.1 429` with `Cf-Mitigated: challenge` (HTML "Just a moment..."), even from a residential IP. It recovered only after a manual redeploy.
- **2026-11-13 08:15:25:** a Worker `GET /health/live` (Cloudflare colo KIX) got 429.
  - `content-type: text/plain; charset=utf-8`, `rndr-id: 5129d71c-4c19-4daa`, `cf-ray: a59c54166ffa836a-KIX`.
  - No `x-render-origin-server` header; answered in 64–355 ms.
  - A residential request at the same minute got 200 with `x-render-origin-server: uvicorn`.
- **2026-11-13 17:45:33:** same pattern from colo HKG: 429, `rndr-id: 86e8d3a9-e6c7-4b31`, `cf-ray: a59f97410e77dd4b-HKG`.
- **2026-11-14 09:39–09:42, 10:17–10:18 and 13:39:** our web Worker failed its API calls within 0.2–0.9 s, while a residential `GET` started at the same time took 44–46 s and then returned 200 (`rndr-id: 36cc5764-c981-408e`, `dc8517e1-d6b8-401c`), i.e. a cold start. The Worker recovered about one minute later.

Our application returns 429 only on authenticated admin routes and one write endpoint. It never does so on `/health/live` or the public GET routes involved. Because these 429s have no `x-render-origin-server` header, we believe they come from in front of our service.

## What we think may be happening

Requests from a Cloudflare Worker to another Cloudflare zone arrive with a fixed client address. Cloudflare's documentation (HTTP headers, `CF-Connecting-IP`) says: for subrequests between Cloudflare zones, `CF-Connecting-IP` is set to `2a06:98c0:3600::103`, the same for every Worker of every Cloudflare customer. If Render's edge rate limits or challenges by client IP, all Workers traffic to Render would share one limit.

Cloudflare also adds `CF-Worker: tunhuabinhnham.com` to our Worker's subrequests, and documents `cf.worker.upstream_zone` for rules that need to identify Worker traffic per zone.

## Questions

1. Do requests to `*.onrender.com` pass through rate limiting or bot challenges keyed on the client IP? If so, is `2a06:98c0:3600::103` (Cloudflare Workers) limited, and what are the limits?
2. Can you confirm, from the `rndr-id` values above, which layer returned the 429s and the fast failures, and why?
3. Is there a supported way for a Cloudflare Worker to call a Render web service without sharing that limit? For example, keying on `CF-Worker` / `cf.worker.upstream_zone`, an allowlist for our zone, or a custom domain.
4. During a Free instance cold start, can requests receive an immediate error instead of waiting for the spin-up? Requests from other networks waited about 45 s and then got 200.
5. Does upgrading to a paid instance type change any of this behaviour (rate limits or challenges), or only the spin-down?

We do not use proxies or rotate IPs, and we are happy to adjust our request pattern (we already cache public pages at the edge for 12 h).

Thank you.
