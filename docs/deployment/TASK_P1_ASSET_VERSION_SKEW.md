# P1: asset version skew during Worker rollouts

Status: **researched and verified locally. Not applied to production.**
- Branch: `research/asset-skew` (from `integration/warm-editorial-v2` @ `2ae7316`).
- Implementing it in the deploy procedure needs owner approval.

## Incident (2026-10-13, gallery deploy `37eef86b` → `d65ec5a0`)

From 14:13:51 to 14:15:03Z (~72 s after `versions deploy …@100%`), 11 requests for the new stylesheet `/_next/static/chunks/1r_u2-zj6a_zg.css` were answered `404 text/html` by the **old** version `37eef86b`.
- At the same time, HTML on the same hostname was already rendered by the new version.
- The result was an unstyled page. The 404 was not cached (`BYPASS`), and it stopped once the rollout had propagated.

## How assets are served during a rollout

- Each Worker version has its **own asset manifest**: the files uploaded with that version. On a request, the asset layer of the version that handles it looks up the path. A miss falls through to that version's Worker, which renders Next's 404 page.
- `versions deploy @100%` does not switch every edge at once. For a short window, some requests (even from one client) still reach the previous version.
- Next's hashed files (`_next/static/chunks/*.js|css`) differ between builds only where code changed: 5 of 42 files between `5e3b349` and `2ae7316`. A hashed file never changes content, so serving an older or newer build's file under its own name is always correct.
- Builds are deterministic for hashed chunks: rebuilding the deployed source reproduced 42/45 production asset names. The 3 differences are the per-build manifests under the random build-ID directory, which the App Router HTML does not reference.
- So skew breaks pages in **both directions**:
  - **forward:** new HTML, request lands on the old version, which lacks the new file (the incident);
  - **backward:** old HTML (a tab opened before the deploy, or an edge still on the old version), request lands on the new version, which lacks the old file.

## What the current OpenNext (`@opennextjs/cloudflare` 1.20.10) offers

`cloudflare.skewProtection` is marked **experimental** ("might break on minor releases"). It works like this (from `dist/cli/templates/skew-protection.js` and `cli/commands/skew-protection.js`):
- It requires a Next `deploymentId`, `CF_WORKER_NAME`, `CF_PREVIEW_DOMAIN`, **`CF_WORKERS_SCRIPTS_API_TOKEN`** and `CF_ACCOUNT_ID` at deploy time. A deployment-id → version mapping is written into a Worker env var.
- The **latest** version proxies requests that carry an older `dpl` / `x-deployment-id` to that version's preview URL. It is active only on the custom domain.
- Assets are covered only with `run_worker_first`, which makes every asset request run the Worker (CPU on every asset).
- **It does not fix forward skew.** The old version's mapping does not contain the new deployment id, so its code takes the "unknown deployment id → serve current version" path, which is still a 404. That is exactly the incident.
- Further cost: an API token in the build environment, experimental status, and extra Worker invocations per asset on the Free plan.

Cloudflare gradual deployments and version affinity apply to percentage splits with a client-provided key, not to a 100% switch. They do not cover this case.

## Solution: neighbouring builds' assets in every version, plus a prepared rollback version

1. **`apps/web/scripts/merge-previous-assets.mjs <target assets> <source assets>...`** copies the `_next/static/**` files of other builds into a version's assets before upload.
   - It never overwrites, so hashes guarantee correctness.
   - It skips build-ID manifests and is idempotent: a second run copies 0.
2. **Two-step frontend rollout.** For new build **N** while **P** (the previous build) is live:
   1. Build N. Archive N's `_next/static`.
   2. Upload **P′ = P's code + P's assets + N's assets**, then deploy P′ @100%. The HTML is unchanged (same code as P), so this step itself cannot skew. Afterwards every edge, old or new, can serve N's files.
   3. Upload **N + P's assets** and deploy N @100%:
      - forward skew: an edge still on P′ has N's assets;
      - backward skew: N has P's assets.
   4. The **rollback target becomes P′**, not P. Rolling back from N to P′ is covered in both directions.
3. **Retention:** archive `_next/static` of the last 3 deployed builds (≈ 1.8 MB each, ~45 files) and merge them all.
   - The Workers Free limit is 20,000 assets per version and 25 MiB per file, so the headroom is large.
   - The archive lives outside git (`apps/web/.deploy-assets/<git-sha>/`, ignored), on the machine that deploys.
   - If an archive is lost, rebuilding that source gives the same hashed files.

Cost:
- One extra `versions upload` + `versions deploy` per release (no new DNS, no paid feature, no API token).
- Worker CPU: none added. Hits are served by the asset layer; the change *removes* the 404 fallthrough invocations seen in the incident.
- Request quota: unchanged. Assets are already billable with Workers Cache enabled.

## Verification: real local Workers (workerd), fixture API

Setup:
- old build `5e3b349` (pre-gallery, CSS `1yy7em2ev-v5k.css`) on :8788;
- new build `2ae7316` (CSS `1r_u2-zj6a_zg.css`) on :8787.

`apps/web/e2e/skew/simulate-skew.mjs <html origin> <asset origin>` loads `/`, `/san-pham`, `/san-pham/tu-5-tang`, `/tin-tuc` in Chromium and WebKit with HTML from one Worker. **Every `/_next/static` request is answered by the other Worker**, exactly like an edge on the other version.

Reproduction: the old Worker answered the new CSS with `404 text/html`, as production did.

| Scenario | Pages styled | Failed asset requests | Page errors | Verdict |
|---|---|---|---|---|
| A: forward, current procedure | 0 / 8 | 24 (new CSS + JS chunks 404) | — | SKEW_BREAKS_PAGES |
| C: backward, current procedure | 0 / 8 | 25 | — | SKEW_BREAKS_PAGES |
| B: forward, old version prepared with new assets (P′) | 8 / 8 | 0 | 0 | NO_SKEW_FAILURE |
| D: backward, new version with previous assets | 8 / 8 | 0 | 0 | NO_SKEW_FAILURE |
| E: control, same version | 8 / 8 | 0 | 0 | NO_SKEW_FAILURE |

Raw results: `apps/web/e2e/skew/result-{A,B,C,D,E}.json`.

## Residual risk (not solved by assets)

- During the window, a **client-side navigation** RSC request (`?_rsc=`) can be answered by the other version's server components. Assets load (fixed), but the RSC payload may come from the neighbouring build. Next has no deployment id to detect it.
- Exposure: navigations inside the ~1–2 min window only.
- Mitigation options:
  - set a Next `deploymentId` so Next detects the mismatch and does a hard navigation; or
  - adopt OpenNext skew protection for the backward case once it is stable.

  Both are separate, reviewable changes.

## Implementation steps (needs approval; no production change made)

1. Add `.deploy-assets/` to `.gitignore`, and seed the archive with the current production build (`d65ec5a0` = source `70dac36`, by rebuilding).
2. Write the procedure into the rollout runbook. Optionally add a `deploy:frontend` script that runs build, merge, upload P′, deploy P′, verify new assets 200 on the apex, upload N, deploy N, verify.
3. On the next frontend release:
   - run the procedure;
   - tail for `/_next/static` 404s during both switches; the expected count is **0**;
   - record P′ as the rollback target.
