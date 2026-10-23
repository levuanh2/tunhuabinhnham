# Authenticated purge probe: analysis of the 2026-10-23 owner runs

## Run 1 (runner v1, ~08:0xZ)

Stopped at line 49 (`preview image refill`, a read-only GET to the preview image key) with `UND_ERR_CONNECT_TIMEOUT` after 10 s. No HTTP response was received: a client-side connection failure, not a Worker or API error. The remaining checks, including production isolation, never ran.

## Run 2 (runner v2, purge at 08:33:45.134Z) — `purge-probe-result-2026-10-23T0832Z-runner-v2.json`

Verdict printed: `AUTH_PURGE_PREVIEW_FAIL`. The client was routed to HKG, KIX, FRA and MAD within three minutes. The FAILs came from the runner's design, not from the cache:

| Check | Observation | Reading |
|---|---|---|
| preview image after rejected purges | FRA HIT, Age 25 at 08:33:38 | entry created 08:33:13, after the rejected purges, by the runner's own colo-seeking GETs: no evidence either way |
| production untouched | FRA HIT, Age 8 at 08:34:15 | created 08:34:07, 22 s after the purge, by the runner's own GETs: no evidence either way (the warm entry was at KIX) |
| preview image after purge | HKG MISS at 08:34:38 (HKG served HIT before) | **purge effective** for the image key |
| preview page after purge | MAD HIT, Age 6 at 08:35:10 | created 08:35:04, after the purge (not stale); MAD never served the pre-purge entry: no proof of purge |
| preview image refill | HKG HIT, Age 43 at 08:35:22 | created ≈ 08:34:39, matching the HKG MISS: a fresh post-purge entry |

Re-read with the v3 rules: image purged PASS; page purged INCONCLUSIVE; production isolation INCONCLUSIVE. No stale entry was observed anywhere.

## Measurement model (runner v3)

Cloudflare Workers Cache (docs read 2026-10-23): tiered by default (per-colo lower tier, upper tier consulted on a miss); keyed by path + query + entrypoint + Worker version, not host; `cross_version_cache` off by default (not set here); tag purges scoped to the calling entrypoint and propagated globally. The docs do not state whether a tag purge is limited to the calling version, so production isolation needs remote evidence.

`Age` travels with the entry through both tiers, so it is colo-independent:

- old = HIT with Age > (response received − event) + 1 s; young = exactly MISS, or HIT with Age + 1 s ≤ (request sent − event).
- purged: FAIL on any old HIT after the purge; PASS on a young response from a colo that served a HIT before; else INCONCLUSIVE.
- survived (production, and preview keys after rejected purges): PASS on any old HIT; FAIL on a young response from a colo that served a HIT before (within 280 s of warming, inside the 300 s TTL); else INCONCLUSIVE.
- Malformed or missing `Age` / `CF-Ray` is no evidence. GETs retry ≤ 3 times on network errors only; POST never.

Simulator (`purge-sim.mjs`, `sim-results/verdicts.txt`, 12 cases): stable, drift-and-return and network flake PASS; images-only purge, stale upper tier and production affected FAIL; continuous drift, production or total network loss, malformed Age, bad CF-Ray and missing headers INCONCLUSIVE. Codex: R1 and R2 REQUEST_CHANGES (fixed), R3 APPROVE.

## If the next run is INCONCLUSIVE

Do not count it as PASS. Replacement gate, based on the documented cache model:

- Image purge effectiveness is already directly proven (run 2, HKG MISS after a HIT).
- Production isolation rests on the documented version-partitioned cache key plus run-3 evidence if any. Even if a preview purge did cross versions, its only effect is a cold production cache (re-render), never stale or private content, because the purge deletes entries and the public/private split is decided before the cache.
- Owner decision required: accept that residual risk, or rerun once from a stable network path (e.g. VPN/proxy off; this machine's shell reached only SIN/HKG during the same day).
