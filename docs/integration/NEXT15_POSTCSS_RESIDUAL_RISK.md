# Residual risk: Next 15 / PostCSS (read-only review, Gate C)

Branch `integration/warm-editorial-v2` @ `c5cef6a`. No dependency was changed in this review.

## Facts (2026-10-11, `npm ls` / `npm audit --package-lock-only`)

- `next@15.5.27 → postcss@8.4.31` (nested, pinned by Next). The app's own `@tailwindcss/postcss@4.3.3 → postcss@8.5.29` is unaffected.
- Full audit: **7** findings (6 high, 1 moderate, 0 critical). Packages: `next`, `postcss`, `braces`, `micromatch`, `fast-glob`, `@next/eslint-plugin-next`, `eslint-config-next`.
- Production-only audit (`--omit=dev`): **2** (1 high `next`, 1 moderate `postcss`).
  This differs from the Gate B.2 handoff, which recorded 0 for `--omit=dev`. The likely causes are advisory-database or lockfile-only mode differences. This review treats **2** as the current value.
- PostCSS advisories: GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849. npm's only fix is `next@16.4.0` (a major upgrade).

## Exposure in this application

- PostCSS runs only at **build time**, on repository CSS (`globals.css`, Tailwind).
- CMS HTML is sanitised by the backend (Bleach allowlist strips `style`) and rendered as data. No CMS or user input reaches PostCSS.
- No runtime endpoint compiles CSS.
- Residual risk: a malicious CSS file or source map introduced into the repository or a dependency at build time. That is a supply-chain/build-integrity risk, not a runtime one.

## Status

**ACCEPTED_RISK** (owner decision 2026-10-11), expiring **2026-11-10**. This is not PASS.

Conditions:
- Builds use repository-controlled CSS only.
- Lockfile is committed and installs use `npm ci`.
- Build runners are isolated.
- Acceptance is invalidated early if untrusted CSS can reach the build.

## Next 16 path

- Codex trial: `experiment/next-16-postcss` @ `d02336d` is **BLOCKED_ENVIRONMENT**. Lockfile resolves `postcss@8.5.23`, but `npm ci` stalled, so there is no build, runtime or auth evidence.
- The lockfile-only audit of that branch shows 9 high findings from other chains, so it is not audit-clean either.
- Any further trial stays on its own branch/worktree and is **not** part of this Gate C. Re-run it where the npm registry install completes, before 2026-11-10.
