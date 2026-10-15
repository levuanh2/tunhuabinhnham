# V1.1 — Contact-click rate limit (V1-SEC-05)

Branch `feat/v1.1-slug-redirect`. Commits:
- `3d57780`: the fix;
- `a96b2b9`: Codex round 1 fixes;
- `fd29879`: Codex round 2 fixes.

No migration, no new service, no paid plan. Not deployed.

## 1. Problem

`POST /api/v1/contact-clicks` counts "Nhắn tin để mua" clicks for the admin dashboard. It had two in-memory limits: 10 requests per visitor per minute and 300 per hour for the whole site.

Root cause, found in an audit before the fix:
- The per-visitor limit (10/min, about **600 per hour**) was higher than the site-wide 300/h.
- Every request that passed the minute check took from the site-wide quota **before** it was validated. That included:
  - unknown or non-public products (422);
  - requests while tracking was switched off;
  - repeated clicks on the same button.

One visitor could therefore use the whole hour. In the new regression test, one visitor at 10/min for an hour stored **300 of 300** on the old code. Every other visitor's clicks were then refused, so they were not counted.

Messenger was never affected: the button opens Messenger first, synchronously, and the tracking call is best effort (`keepalive`).

## 2. Fix

Order in `track_contact` (`apps/api/app/api/v1/public.py`):

| Step | Result | Uses quota? |
|---|---|---|
| 1. Body validation (Pydantic: `product_id` UUID or null, `source` one of 4 values) | 422 | no |
| 2. Request rate per visitor, 10/min (bounds the DB lookups below) | 429 + `Retry-After` | per-minute only |
| 3. Tracking switched off in CMS | 202 `{"accepted": false}` | no |
| 4. Unknown or non-public product | 422 | no |
| 5. Same visitor + product + button within 30 s | 202 `{"accepted": false}`, not stored | no |
| 6. Per-visitor cap: **20 stored clicks per hour** | 429 + `Retry-After` | no |
| 7. Site-wide cap: 300 stored clicks per hour | 429 + `Retry-After` | no |
| 8. Insert | 202 `{"accepted": true}` | yes, one of each |

How the quota is held and returned:
- Steps 5–8 run in `contact_click_quota()`, a context manager in `apps/api/app/core/rate_limit.py`. A refused step gives back the earlier ones.
- **Any** storage failure gives back exactly what was taken. An `IntegrityError` (product deleted meanwhile) still answers 422; other failures answer 500.
- A refused check counts nothing.
- Each admission returns its window start, read under the limiter lock, as a token. A give-back only credits that exact window, never a newer one (Codex rate-limit rounds 1–2).
- Settings refuse a per-visitor hourly cap at or above the site-wide one.

New settings, with safe defaults:
- `CONTACT_CLICK_CLIENT_LIMIT_PER_HOUR=20`;
- `CONTACT_CLICK_REPEAT_SECONDS=30`.

The existing settings are unchanged: `CONTACT_CLICK_LIMIT_PER_MINUTE=10`, `CONTACT_CLICK_GLOBAL_LIMIT_PER_HOUR=300`, `CLIENT_IP_HEADER=CF-Connecting-IP`. No `render.yaml` change is needed.

API compatibility: same paths and status codes. A repeat answers 202 with `accepted: false`, the same shape as "tracking off". The frontend ignores the body.

## 3. Visitor identity and privacy

- Only one header is trusted: `CF-Connecting-IP`. Cloudflare overwrites it in front of onrender.com, and refuses a client-sent one with 403. This was measured on 2026-10-14.
  - Only a single valid IP is accepted. Anything else (a list, garbage, an empty value) falls back to the socket peer.
  - `X-Forwarded-For`, `True-Client-IP` and `X-Real-IP` are ignored (tests).
- IPv6 addresses are grouped by /64.
- No IP or IP hash is stored. The limiter keys live only in process memory.
- Assumption: the origin is reachable only through Cloudflare. If an origin path that bypasses Cloudflare ever appears, a forged header would bypass the per-visitor and repeat limits, **but not the site-wide cap**.

## 4. Limits of this fix (accepted risks)

This protects a small analytics quota from cheap starvation. It is **not spam-proof and not DDoS protection.** Messenger and buying stay available even when tracking is refused.

| Risk | Detail |
|---|---|
| IP rotation | 15 identities (IPv4 or IPv6 /64) × 20 clicks still use the 300/h. 300 identities with 1 click each do the same. It is harder than before (it was 1 identity) but not impossible |
| Shared addresses | Visitors behind one IPv4 or one /64 (an office, mobile CGNAT) share 20 per hour |
| Fixed windows | Around a window boundary, up to twice a limit can pass in a short interval |
| Bounded memory | Each limiter holds at most 10,000 keys (about a few MB in total). When full of live keys, a new key is refused until the oldest window expires: up to 1 min (requests), 1 h (per-visitor), or 30 s (a new click treated as a repeat). Needs very high fan-out |
| Restart or spin-down | Counters live in memory. A Render restart or Free-plan spin-down starts every window afresh, so at most one more hourly quota per restart. More than one worker would multiply the limits; a shared store would then be needed |

## 5. Tests

`apps/api/tests/test_contact_clicks.py`: 31 tests (25 functions, some parametrized).

Fail-before: 8 new tests failed on `503ec9b` (one visitor stored 300/300; refused requests turned 422 into 429; tracking off used quota; repeats were stored; no hourly cap; no concurrency guarantee; unbounded limiter set). 2 more failed on `3d57780`: a non-`IntegrityError` storage failure kept the quota, and the configuration accepted an unfair cap. 1 more failed on `a96b2b9`: a give-back after a window rollover credited the newer window.

| Required case | Test |
|---|---|
| Normal click | `test_valid_click_is_stored_without_ip` |
| One visitor spamming for an hour | `test_one_spamming_visitor_cannot_starve_the_others` (20 stored; another visitor still counted) |
| Same product clicked repeatedly | `test_the_same_click_repeated_quickly_is_stored_once` |
| Two independent visitors | same test, plus `test_global_cap_holds_across_clients` |
| Many visitors at once | `test_concurrent_visitors_never_exceed_the_caps` (60 threads: never over 15 site-wide or 4 per visitor); `test_concurrent_requests_never_exceed_the_limit` |
| Invalid request | `test_malformed_body_is_422`; `test_refused_and_invalid_requests_use_no_site_wide_quota` |
| Unknown product | `test_unknown_or_non_public_product_is_422` |
| Forged IP headers | `test_spoofed_ip_headers_do_not_bypass_the_limit`; `test_default_config_ignores_other_forwarding_headers`; `test_rotating_forged_forwarding_headers_does_not_lift_the_hourly_cap` |
| Site-wide quota | `test_global_cap_holds_across_clients`; `test_a_refusal_during_a_failed_store_leaves_the_quota_free` |
| Per-visitor quota | `test_hourly_caps_recover_after_an_hour`; `test_a_visitor_can_never_be_allowed_the_whole_site_quota` |
| Storage failure | `test_any_storage_failure_gives_the_quota_back`; `test_a_late_give_back_never_credits_a_newer_window`; `test_refused_requests_are_not_counted` |
| Render restart | `test_a_restart_forgets_every_count` (documents the accepted behaviour) |
| Limiter memory | `test_limiter_memory_is_bounded_and_recovers`; `test_contact_limiters_are_bounded` |
| Messenger on 429, 500 or timeout | e2e `responsive 6b`: Messenger opens within 1.5 s while tracking takes 5 s and then answers 429, answers 500, or times out (Chromium and WebKit, desktop and mobile) |

Backend total: **137 passed**, 0 failed. Ruff and mypy are clean.

## 6. Independent review (Codex)

- Round 1 (`3d57780`): **APPROVE**, P0 0, P1 0, P2 1, P3 2.
  - P2 reservation accounting under contention or on other failures: fixed in `a96b2b9`.
  - P3 unfair configuration: fixed by the validator.
  - P3 race-test cleanup: fixed with `finally`.
- Round 2 (`a96b2b9`): **APPROVE**, P0 0, P1 0, P2 0, P3 2.
  - P3 refund after a rollover used the give-back time instead of the admission window: fixed in `fd29879` with exact window tokens.
  - P3 PG test timeout could still wait at executor shutdown: fixed.
- Round 3 (`fd29879`, the two P3 follow-ups only): **not yet run**. Codex reached its usage limit on 2026-10-15, usable again from 18:12. The request is in `c21-release-validation/v1.1-slug/RL3_REQUEST.md`; run it before the backend deploy.
