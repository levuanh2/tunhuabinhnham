# Gate B.2 handoff

## Baseline

- Branch: `fix/postcss-security`
- Starting SHA: `2715b8f54d4d4b77f9725ba3b6c3dec0ecb60248`
- Verified code SHA: `fa9e586b25ddb4b982b3b34fdec4d05324ff8c96`
- Final handoff SHA: use the branch tip reported with this handoff (the handoff file itself is the final commit).
- Status: **READY_WITH_ACCEPTED_RISK**. The functional baseline and all non-audit gates pass; the owner accepted the time-boxed build-tooling risk described below.

## Dependency audit and accepted-risk decision

The proposed root `packageExtensions` entry was removed because npm does not read that Yarn/pnpm field. A real clean install proves that Next `15.5.27` still installs its exact dependency `postcss@8.4.31`:

```text
next@15.5.27
`-- postcss@8.4.31
```

An npm-native override was tested both in isolation and in this workspace. In this npm `11.12.1` workspace it produced an invalid tree (`npm ls` exited `ELSPROBLEMS`) even though lock-only audit output appeared clean. That false remediation was not retained. The repository therefore keeps the consistent, truthful Next 15 lockfile. `npm ci` succeeds.

`npm audit --json` result on the final tree:

- Total: 7 (`6 high`, `1 moderate`, `0 critical`).
- Next/PostCSS: `next@15.5.27 -> postcss@8.4.31`; PostCSS is affected by `GHSA-qx2v-qp2m-jg93`, `GHSA-6g55-p6wh-862q`, `GHSA-fxqj-rqcc-2cmp`, and `GHSA-r28c-9q8g-f849`. npm offers only `next@16.4.0` as the fix.
- ESLint toolchain: five high dependency findings collapse to `braces@3.0.3` (`GHSA-vfj7-8cjw-p6xm`) through `micromatch -> fast-glob -> @next/eslint-plugin-next -> eslint-config-next`. `npm view braces version` returns `3.0.3`, so no patched braces release is available. npm proposes the incompatible `eslint-config-next@14.2.35` change.
- `npm audit --omit=dev --json` reports zero, but this is not treated as proof that the Next/PostCSS path is fixed because `npm ls` directly confirms the nested vulnerable version.

### ACCEPTED_RISK: Next 15 / PostCSS advisory

- Decision date: `2026-10-11`.
- Review and expiry date: `2026-11-10` (30 days). The acceptance must be renewed explicitly or replaced by a verified remediation by that date.
- Scope: retain Next `15.5.27` and its pinned `postcss@8.4.31` for the integration baseline. Next 16 is evaluated only on the separate `experiment/next-16-postcss` branch and does not block this baseline.
- Exposure constraint: PostCSS is used during the trusted application build. CMS content is stored/rendered as application data and is never submitted to PostCSS; there is no runtime endpoint that compiles user- or CMS-controlled CSS.
- Mitigations: builds use repository-controlled CSS only; do not accept untrusted CSS or source maps as build inputs; keep build workers isolated and least-privileged; preserve the committed lockfile; monitor Next/PostCSS and npm advisories; move to a supported patched dependency path as soon as compatibility verification succeeds.
- Early invalidation: this acceptance ends immediately if CMS/user-controlled data can reach PostCSS, the build begins consuming untrusted CSS/source maps, exploitation is observed, or a compatible patched Next 15 release becomes available.
- Verification owner action: review the separate Next 16 experiment result before the expiry date and decide whether to upgrade, renew with justification, or stop the affected build path.

The `braces@3.0.3` finding is confined to the lint/build toolchain, has no patched npm release as of the decision date, and is covered by the same isolated-build controls and `2026-11-10` review deadline. Neither accepted item is marked PASS.

## Verification

| Check | Command | Result |
|---|---|---|
| Reproducible install | `npm ci` | PASS; 815 packages installed; audit remains 7 as documented above |
| Dependency tree | `npm ls postcss next @opennextjs/cloudflare --all` | PASS as an accurate tree: Next 15.5.27, OpenNext 1.20.9, nested PostCSS 8.4.31 |
| Web lint | `npm run lint` | PASS |
| TypeScript | `npm --workspace apps/web run typecheck` | PASS |
| Web unit tests | `npm --workspace apps/web test` | PASS; 1 file, 1 test |
| Next production build | `npm run build` | PASS; Next 15.5.27, 20 pages, middleware and auth routes compiled |
| OpenNext build | `npm run build:cloudflare` | PASS; OpenNext 1.20.9 / AWS adapter 4.1.8; Worker bundle generated |
| Ruff | `.venv\Scripts\python.exe -m ruff check apps/api` | PASS |
| Strict mypy | `.venv\Scripts\python.exe -m mypy apps/api/app apps/api/scripts apps/api/tests` | PASS; 40 files |
| Backend tests | `.venv\Scripts\python.exe -m pytest apps/api/tests -m "not integration_supabase"` | PASS; 30 passed, 2 live integration tests deselected |
| Security regression | `.venv\Scripts\python.exe -m pytest apps/api/tests/test_auth.py apps/api/tests/test_security_migration.py apps/api/tests/test_security_validation.py apps/api/tests/test_cors.py` | PASS; 11 passed |
| Python dependency audit | `.venv\Scripts\python.exe -m pip_audit -r apps/api/requirements.lock` | PASS; no known vulnerabilities |

Both web builds logged expected local API `ECONNREFUSED` messages while prerendering without the API server, then completed successfully. OpenNext also emitted its standard Windows/WSL recommendation; bundle generation passed.

## Auth and middleware compatibility

A local Next production-server smoke test verified:

- unauthenticated `/admin` and `/admin/bai-viet` return `307 /admin/login`;
- protected redirects include `Cache-Control: private, no-store, max-age=0` and `Vary: Cookie`;
- `/admin/login` remains public (`200`);
- cross-origin `POST /api/auth/logout` returns `403`;
- Next and OpenNext compilation both include the middleware and `/api/auth/logout` route.

No external authentication state was changed.

## Migration `0004` review (not applied)

Reviewed `apps/api/alembic/versions/0004_security_hardening.py` and canonical `supabase/migrations/20261011041446_security_hardening.sql` against the current Supabase security guidance and Postgres RLS/privilege practices.

- PASS: incremental and non-destructive; no table/data drops.
- PASS: Alembic remains a thin ordered wrapper over the single canonical SQL file (`0003 -> 0004`).
- PASS: enables RLS and revokes Data API roles on `alembic_version` and internal tables.
- PASS: public catalogue access is explicit `SELECT` only; existing RLS policies remain the row-authorization layer.
- PASS: `set_updated_at()` is `SECURITY INVOKER`, has an empty `search_path`, and is not directly executable by public Data API roles.
- PASS: default table/function privileges are narrowed for future objects created by the migration executor.
- Operational note: default privileges are per object-creator role; after an approved application, run the existing live security audit as the actual migration role to verify hosted grants.

The current Supabase changelog was reviewed. The recent Postgres extension-version and platform changes do not affect this migration (it creates/alters no extensions). No Supabase writes, migration application, deployment, or secret output occurred.

## Integration notes

- Integrate the final branch tip reported with this handoff into the separate integration worktree.
- Do not treat the removed `packageExtensions` proposal or an npm workspace override as remediation.
- This branch does not touch `apps/web/src` UI files or the design worktree/branch.
- Gate B.2 is READY for integration under the time-boxed `ACCEPTED_RISK` decision above.
