# Release closure — V1.1 and Performance Hotfix (2026-10-23)

**Verdict: PRODUCTION_HANDOVER_READY_WITH_ACCEPTED_RISKS.** No real blocker found.

| Release | Status | Report |
|---|---|---|
| V1.1 (slug redirect 301, contact-click rate limit, cache isolation) | **COMPLETED** — V1_1_PRODUCTION_PASS_WITH_ACCEPTED_RISKS (2026-10-17) | branch `chore/consolidate-codex-prod` → `docs/qa/evidence/v1.1-slug/V1_1_PRODUCTION_FINAL_QA.md` |
| Performance Hotfix (image edge cache, no prefetch) | **COMPLETED** — PERF_HOTFIX_PRODUCTION_PASS_WITH_ACCEPTED_RISKS | `PERF_HOTFIX_PREVIEW_GATE.md` § Step B |
| Source on GitHub | GITHUB_SOURCE_SYNC_PASS | `GITHUB_SYNC_AND_BACKUP_PLAN.md` |
| `.deploy-assets` archive (local) | ASSET_BACKUP_LOCAL_PASS (227/227) | same |
| Encrypted environment backup, off-device copy | **ACCEPTED RISK — OWNER DEFERRED** (not verified, not PASS) | same, § Closure |

## Production identity

- Worker `tunhuabinhnham-web`: 100% `ace736be-c3d6-443e-a454-d7bae8c69681` (source `0cfcd7d`, tag `worker-ace736be`). Rollback: P′ `b2d3421d-5d82-47e7-b7eb-fa427f4872dc`.
- Backend Render `tunhuabinhnham-api`: `1ab6f7c` (`deploy/c2-preview`, auto-deploy off).
- Database: Supabase `fyaourksnjeldsvuedox`, Alembic `0006`.

## Closing read-only check (2026-10-23 ~15:40Z)

| Check | Result |
|---|---|
| `wrangler deployments status` | 100% `ace736be` |
| API `/health/live`, `/health/ready` | 200, 200 (first call 37.7 s: Render Free waking from idle; then 2.2 s) |
| `/`, `/san-pham`, `/tin-tuc`, `/lien-he`, `/admin/login` | 200 (2.2–2.8 s cold from this machine; admin login 0.9 s) |
| Product `/san-pham/tu-nhua-4-canh-4` | 200 |
| Product image via `/_next/image` | 200 `image/webp` |

No new defect found; no further QA rounds.

## Accepted risks

1. HTML tag purge on the release version: INCONCLUSIVE; HTML still expires within 300 s.
2. Deleted image: browser copy up to 1 h, edge copy up to 1 day if a purge fails (admin is warned).
3. Backend latency Render Singapore ↔ Supabase Sydney, and Render Free spin-down: the first request after idle takes 30–60 s.
4. OpenNext 7 s image source timeout is upstream; failures fall back to the original image.
5. No concurrency benchmark on production (5/10 sessions measured in the test environment only).
6. Historical-slug 301 not replayed on production (no slug has been renamed yet).
7. Encrypted environment backup and off-device copy: owner deferred. Today the only copies of `.deploy-assets` and of the env files are on this machine (USB disk `E:` and the internal disk `C:`); the source is on GitHub.
8. `apps/api/.env` on the USB disk holds production database and Supabase secret keys in plaintext, readable by any local account and by anyone with the disk. Not in Git; 0 occurrences in history, logs or transcripts.
9. The weak production database password (P0, `GATE_C3_1_FREE_OPTIMIZATION.md`) remains open.
10. Workers Free limits: cold renders use 140–360 ms CPU (above the Free 10 ms per-request budget) and Workers Cache hits count toward 100,000 requests/day; no 1102/1027 observed so far. Workers Paid is the planned remedy.

## Operational tasks (not release blockers)

| Priority | Task | Owner |
|---|---|---|
| High | Rotate the production database password (open P0); update `DATABASE_URL` in Render; then remove or encrypt `apps/api/.env` | owner + technical admin |
| High | Store every provider secret and account recovery code in a password manager (Render env, Supabase keys/DB password, Cloudflare, GitHub) | owner |
| High | Make one verified off-device copy of `deploy-assets-20261023T151345Z.*` (sign in to OneDrive or use another device; check SHA-256 at the destination) | owner |
| Medium | Run `encrypt-env.sh` procedure (GPG AES-256) for the env files when convenient | owner |
| Medium | Check what database backups the Supabase plan provides; the only local dump is pre-0006 (2026-10-15) | owner |
| Medium | Set real `Messenger URL` and contact details in `/admin/cai-dat` (V1 NOT_READY item) and test the contact button | shop owner |
| Medium | First real product slug change: check `curl -sI https://tunhuabinhnham.com/san-pham/<old>` gives 301 to the new slug with `no-store` | technical admin |
| Medium | Decide on Workers Paid ($5/month) if 1102/1027 errors or the daily request limit appear in the dashboard | owner |
| Low | Weekly: Cloudflare dashboard Errors/CPU and Images transformations for `ace736be` (Free: 5,000 unique transformations / month) | technical admin |
| Low | After each future release: archive the new build into `.deploy-assets`, refresh the backup, keep the last 3 builds | technical admin |
| Low | Push the local docs commits on `fix/perf-image-cache` (closure, backup, recovery, handover) when the owner approves | owner |
| Low | Optional: enable BitLocker To Go on the USB disk | owner |

## Handover documents

- Shop owner: `docs/handover/CMS_HANDOVER_CHECKLIST.md`.
- Technical recovery: `docs/deployment/PRODUCTION_RECOVERY_CHECKLIST.md`.
