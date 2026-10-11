# Gate C readiness: integrated frontend

**Verdict: NOT READY for production.** The integration branch is code-complete and passes every test that runs locally. Production depends on the owner actions and real-environment checks below. Nothing has been deployed.

Integration branch: `integration/warm-editorial-v2`. Tested commit: `2ad72ac`. Codex baseline: `290897d`.

## Done

- Gate B.2 baseline: READY_WITH_ACCEPTED_RISK (Codex).
- Warm Editorial V2 design integrated with no conflicts. Pixel-identical to the approved design.
- Web: lint, types, unit, Next build, OpenNext build, Wrangler preview, and Playwright on both Node and the Worker (28/28 runnable tests pass in each).
- Backend: ruff, mypy strict, pytest, security regression, pip-audit (all PASS at `2ad72ac`).
- Migration 0004 reviewed by Codex (not applied).

## Must happen before Gate C / production

| # | Item | Owner | Notes |
|---|---|---|---|
| 1 | **Rebuild from clean, real configuration.** `E:\Tunhuabinhnham-integration\apps\web\.env.local` was a *local QA file* pointing at the fixture API/fake auth. Claude **deleted it and the `.next/` and `.open-next/` build outputs** after QA. Any deploy build must be made fresh with production `NEXT_PUBLIC_*` values supplied by the deploy environment. | Deploy owner | Never deploy an artefact built in this worktree before that rebuild. Never ship `e2e/fixtures/mock-api.mjs` as a backend. |
| 2 | **Dependency risk expiry 2026-11-10** (Next 15 / PostCSS 8.4.31; braces). Before that date: upgrade to Next 16 after a passing trial, renew with justification, or stop the affected build path. After it, this branch is not Gate-C eligible. | Owner + Codex | Next 16 trial `d02336d` is BLOCKED_ENVIRONMENT (npm ci stalls here). Re-run where the registry is reachable. Set a reminder. |
| 3 | Real Supabase E2E (login, SSR session persistence, nested `/admin` protection, logout cookie cleanup, expired session, product create/edit, category retention, image upload, primary image, `sort_order` after reload, draft/publish, news, banners, logo/favicon, settings, cache invalidation) | Owner approval → Codex + Claude | Only under an approved procedure: verified project identity, snapshot and restore, unique run IDs, cleanup. `staging-cms.spec.ts` is ready (layout-agnostic). |
| 4 | CMS: set `store_name` to **Tủ Nhựa Bình Nhâm** | Owner | Admin → Cài đặt. No hardcoded override exists. |
| 5 | Apply migration 0004 to the target database | Owner approval → Codex | Reviewed, not applied. Then run the live security audit as the migration role. |
| 6 | Real content (product photos, banners, posts) and a visual pass on real data | Owner / content | Current visuals use fixtures. |
| 7 | Real-device check (iPhone Safari, Android Chrome) and screen readers | QA | Only emulation so far. |
| 8 | Lighthouse mobile on staging | QA | Not run (no npm network). Lab vitals are within targets. |

## Production safety log

No deploy, no Render or Cloudflare resource or DNS change, no Supabase write or migration, no push, no merge to `main`, and no secrets in outputs or commits.
