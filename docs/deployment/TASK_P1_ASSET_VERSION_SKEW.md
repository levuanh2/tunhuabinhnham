# P1: asset version skew during Worker rollouts

Status: **procedure approved for the next frontend release** (owner, 2026-10-13).
- Tooling verified locally on real workerd Workers.
- No production change made by this task.
- Branch: `research/asset-skew` (from `integration/warm-editorial-v2` @ `2ae7316`).

## Incident (2026-10-13, gallery deploy `37eef86b` → `d65ec5a0`)

From 14:13:51 to 14:15:03Z (~72 s after `versions deploy …@100%`), 11 requests for the new stylesheet `/_next/static/chunks/1r_u2-zj6a_zg.css` were answered `404 text/html` by the **old** version `37eef86b`.
- At the same time, HTML on the same hostname was already rendered by the new version, so the page rendered unstyled.
- The 404 was not cached (`BYPASS`), and it stopped once the rollout had propagated.

## Findings

### How assets are served during a rollout

- Every Worker version has its **own asset manifest**: the files uploaded with that version.
  - On a request, the asset layer of the version that handles it looks up the path.
  - A miss falls through to that version's Worker, which renders Next's 404 page (`text/html`). That produces both the 404 and the MIME mismatch for a stylesheet.
- `versions deploy @100%` does not switch every edge at once. For ~1–2 minutes, consecutive requests of one visitor can reach different versions.
- Next writes content-hashed files under `_next/static/chunks/`. A given name never changes content, so serving it from any version that has it is correct.
  - Between `5e3b349` and `2ae7316`, only 5 of 42 hashed files differ.
- **Build ID and asset routing.** Each build also writes `_next/static/<BUILD_ID>/_buildManifest.js|_ssgManifest.js|_clientMiddlewareManifest.js`, with a random build ID. The App Router HTML does not reference these files, so the merge skips them.
  - The build ID is embedded in RSC payloads. On a mismatch, Next falls back to a full page load (see the verification below).
- **Determinism.** Rebuilding a commit reproduces its hashed chunk names: 42/45 production names after a rebuild; the 3 differences are the build-ID files.
  - Hashes depend on **all** files Tailwind v4 scans, including `e2e/` and `scripts/`. Two commits with identical app code but different tooling files can produce different CSS names. This is harmless for the merge, which compares bytes, but archives must be taken from the exact deployed commit.
- So skew breaks pages in **both directions**:
  - **forward:** new HTML, assets from the old version (the incident);
  - **backward:** old HTML (a tab opened before the deploy, or an edge still on the old version), assets from the new version.

### OpenNext / Cloudflare skew protection (`@opennextjs/cloudflare` 1.20.10)

- `cloudflare.skewProtection` is **experimental** ("might break on minor releases").
- Requirements:
  - a Next `deploymentId`;
  - `CF_WORKER_NAME`, `CF_PREVIEW_DOMAIN`, `CF_ACCOUNT_ID`;
  - a **`CF_WORKERS_SCRIPTS_API_TOKEN`** in the build/deploy environment, which writes a deployment-id → version mapping into a Worker env var.
- How it works: the **latest** version proxies requests carrying an older `dpl` / `x-deployment-id` to that version's preview URL (custom domain only). For assets it needs `run_worker_first`, which makes every asset request run the Worker (CPU per asset on the Free plan).
- **It cannot fix forward skew.** The old version's mapping does not contain the new id, so it takes the "unknown deployment id → serve current version" path, which is still a 404.
- Decision: **not adopted.** It is experimental, needs an API token in the deploy environment, adds Worker CPU per asset and does not cover the observed incident.
- Cloudflare gradual deployments / version affinity concern percentage splits with a client key, not a 100% switch.

## Solution

### 1. `apps/web/scripts/merge-previous-assets.mjs`

```
node scripts/merge-previous-assets.mjs [--dry-run] <target .open-next/assets> <source assets dir>...
```

- **Build artifacts only.** The target must be a `.open-next/assets` directory. Target and sources must contain `_next/static`. Only `_next/static/**` is copied (no HTML, no route files), and the build-ID manifests are skipped. Source code and production data are never touched.
- **Never overwrites.** It uses `COPYFILE_EXCL`. If the same path has different bytes (SHA-256, checked across the target and all sources), it **aborts before writing anything** (exit 1).
- **Limits.** It aborts if a file exceeds 25 MiB or the merged version exceeds 20,000 files: the Workers Free static asset limits (Paid: 100,000 files), confirmed in the Cloudflare docs on 2026-10-13. Today one version holds 45 files, 52 after a merge.
- **Idempotent.** A second run copies 0. `--dry-run` reports the plan.

### 2. Two-step frontend rollout

Let **P** be the live build and **N** the new build.

| Step | Version | Code | Assets | Why it cannot skew |
|---|---|---|---|---|
| A | **P′** | P's code, unchanged | P + N (+ retained) | Same HTML as P, so P↔P′ edges are interchangeable; afterwards every edge can serve N's files |
| B | **N** | new code | N + P (+ retained) | Forward: edges still on P′ have N's files. Backward: N has P's files |
| Rollback | **P′** | — | P + N | Both HTML generations keep their assets. The original P is **not** a safe rollback target (scenario 1 below) |

### 3. Retention policy

Keep `_next/static` of the **last 3 deployed builds** in `apps/web/.deploy-assets/<git-sha>/_next/static` (git-ignored, on the deploying machine; ≈ 1.8 MB each). Merge all of them into every new version.
- Covers tabs that stay open across two releases.
- A lost archive can be recreated by rebuilding that exact commit (deterministic chunk names).
- The merge test `keeps several previous builds (retention)` covers 3 sources.

## Verification

### Script tests (`scripts/merge-previous-assets.test.mjs`, Vitest, 6/6)

- Copies only the other build's hashed files; HTML and build-ID manifests are not copied; sources are untouched; a second run is a no-op.
- **Collision:** same path with different content aborts, and nothing is written, not even other files of the plan.
- Collisions between two sources are detected as well.
- Retention: 3 previous builds are merged. The file-size and file-count limits abort the merge.
- A target that is not `.open-next/assets`, or a source without `_next/static`, is refused.
- `--dry-run` writes nothing. The CLI exits 1 on a collision and leaves files intact.

On real builds:
- P′ gets 5 copied and 37 already present; N the same; a rerun copies 0.
- A tampered copy of a real CSS file is refused: `merge aborted, nothing written: same path, different content … 1yy7em2ev-v5k.css`.

### Mixed-version simulation (`e2e/skew/simulate-skew.mjs`)

Setup: two real local Workers (wrangler dev / workerd) with the fixture API.
- **P** = `5e3b349`, CSS `1yy7em2ev-v5k.css`, on :8788.
- **N** = this branch's app code (= `2ae7316`), CSS `208zou2ye3jnp.css`, on :8787.

Two modes, each in Chromium and WebKit:
- **mixed:** `/`, `/san-pham`, a product, `/tin-tuc` and `/admin/login`, each with its HTML from one Worker and **every** `/_next/static` request answered by the other.
- **navigate** (1440 and 390 px): a tab opened before the deploy. After the switch, every asset **and RSC/prefetch** request goes to the other version. The visitor client-navigates to `/san-pham`, then to a product, presses Back, then hard-refreshes (HTML from the new side).

Checks: asset status, MIME (CSS `text/css`, JS `javascript`), page styled (design font and background applied), page errors, navigation success.

| # | Scenario | Unstyled | Asset / MIME problems | Page errors | Failed nav steps | Verdict |
|---|---|---|---|---|---|---|
| 1 | Forward, **current procedure** (N HTML, P assets). This is the incident, and equally a rollback from N to the original P | 10 / 10 | 44 | 15 | 6 | SKEW_BREAKS_PAGES |
| 2 | Backward, **current procedure** (P HTML, N assets): tab opened before the deploy | 10 / 10 | 43 | 16 | 8 | SKEW_BREAKS_PAGES |
| 3 | Forward, **two-step** (N HTML, P′ assets): release window, and rollback N → P′ | 0 / 10 | 0 | 0 | 0 | NO_SKEW_FAILURE |
| 4 | Backward, **two-step** (P′ HTML, N assets): tab opened before the release | 0 / 10 | 0 | 0 | 0 | NO_SKEW_FAILURE |
| 5 | Control, same version | 0 / 10 | 0 | 0 | 0 | NO_SKEW_FAILURE |

Raw results: `apps/web/e2e/skew/result-{1..5}.json`. Scenarios 1 and 2 ran on the unmerged builds with the same script before the RSC counters were added. They fail on assets regardless.

**RSC under skew (scenarios 3 and 4):**
- All RSC requests answered by the other version returned **200** (175 and 173).
- Because the build ID differs, Next replaced each cross-version client navigation with a **full page load** (12 hard-navigation fallbacks, measured as extra document loads; 0 in the control). Navigation succeeded and pages stayed styled.
- WebKit reports the prefetches it cancels during those reloads as `… _rsc=… due to access control checks`. These are counted separately as `abortedPrefetchesDuringHardNavigation` (1 and 2), not as page failures.
- Remaining cost: client navigation in the ~1–2 minute window is a full reload instead of a soft navigation. This is acceptable and needs no extra mechanism.

### Cache and CPU impact

- The Workers Cache key includes the Worker version. **Every version switch starts a cold HTML/RSC cache**, so the two-step rollout means two cold starts per release instead of one.
- The extra cost is one MISS per cacheable key (about 8 public pages plus their RSC prefetch variants) per active Cloudflare location.
  - That is hundreds of Worker invocations per release, against the 100,000 requests/day Free quota.
  - Each MISS uses the usual CPU (p50 ≈ 16–28 ms, the existing Free-plan risk; no 1102 observed so far).
- Mitigation: run step B right after step A's verification, not hours later, so both cold windows fall in one quiet period. Don't redeploy P′ needlessly.
- Assets: no change in request billing (already billable with Workers Cache). Merged assets *remove* the 404 fallthrough Worker invocations seen in the incident.
- Hard-navigation fallbacks during the window are ordinary page loads: they hit the new version's cache.

### Codex independent review

_Pending._ The result is recorded below when available.

## Standard procedure for frontend releases

Run it in `E:\Tunhuabinhnham-integration\apps\web`, which has the production public env (`.env.production.local`). Backend first, if the release also changes the API. Never change DNS or plans.

0. **Record the live state.**
   - `npx wrangler deployments status` gives `P_VERSION`.
   - `P_SHA` is the commit P was built from (recorded in the previous release's report).
   - Copy the merge script outside the repo, because older commits may not contain it:
     `cp scripts/merge-previous-assets.mjs "$TMP/merge.mjs"`
1. **Build N.**
   - `git checkout <N_SHA>`, then `npx opennextjs-cloudflare build`.
   - Archive: `mkdir -p .deploy-assets/<N_SHA> && cp -r .open-next/assets/_next .deploy-assets/<N_SHA>/`.
2. **Step A: P′.**
   1. `git checkout --detach <P_SHA>`, then `npx opennextjs-cloudflare build`.
   2. `node "$TMP/merge.mjs" .open-next/assets .deploy-assets/<N_SHA> .deploy-assets/<older retained>...` (must exit 0).
   3. Scan the bundle for secrets.
   4. `npx wrangler versions upload --tag p-prime --message "P′: <P_SHA> + assets of <N_SHA>"` gives the preview URL.
   5. Preview smoke: the old and the new CSS/JS names are both 200 with the right MIME; pages look identical to P.
   6. `npx wrangler versions deploy <P′>@100%`.
   7. Tail; on the apex, check that the new and old asset URLs return 200 for ~3 minutes.
   8. Record `P′_VERSION`; it is now the rollback target.
3. **Step B: N.**
   1. `git checkout <N_SHA>`, then rebuild.
   2. `node scripts/merge-previous-assets.mjs .open-next/assets .deploy-assets/<P_SHA> .deploy-assets/<older retained>`.
   3. Scan the bundle; upload with `--tag release`.
   4. Preview smoke: Gate C3.1 cache, admin and RSC checks, plus the release's own checks.
   5. `npx wrangler versions deploy <N>@100%`, with tail running.
   6. Pass criterion: **0 `/_next/static` 404s** in the tail during and after the switch. Then run the usual apex smoke.
   7. Record `N_VERSION` and `P′_VERSION` (the rollback target).
4. **Rollback:** `npx wrangler versions deploy <P′_VERSION>@100%`.
5. **Retention:** keep the 3 most recent `.deploy-assets/<sha>` directories and delete older ones.
6. `git checkout integration/warm-editorial-v2` (leave the worktree on its branch).

**First use:**
- Seed `.deploy-assets/70dac36` by rebuilding `70dac36`, the source of the current production `d65ec5a0`.
- Check that its chunk names match production (for example `1r_u2-zj6a_zg.css` returns 200 on the apex).
- Then `P_SHA = 70dac36`.

Stop conditions:
- any asset 404 or MIME mismatch on the apex;
- a non-zero merge exit;
- a secret in the bundle;
- any security or admin regression.

On any of these, stop and roll back to P′.
