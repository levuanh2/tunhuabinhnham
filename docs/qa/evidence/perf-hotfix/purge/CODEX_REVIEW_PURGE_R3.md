codex
P0: None.

P1: None.

P2: None. The prior finding is resolved. Malformed `Age` becomes `null`, while raw input remains in `ageRaw`; invalid `CF-Ray` produces no colo ([purge-probe.mjs](E:/Tunhuabinhnham/docs/qa/evidence/perf-hotfix/purge/purge-probe.mjs:55)). Cache gates require verified age or valid same-colo evidence ([purge-probe.mjs](E:/Tunhuabinhnham/docs/qa/evidence/perf-hotfix/purge/purge-probe.mjs:75)). Failed, absent, or unusable evidence therefore yields `FAIL` or `INCONCLUSIVE`, which cannot produce the final PASS verdict ([purge-probe.mjs](E:/Tunhuabinhnham/docs/qa/evidence/perf-hotfix/purge/purge-probe.mjs:163)).

P3: None.

The simulator correctly injects malformed ages, invalid rays, and missing headers ([purge-sim.mjs](E:/Tunhuabinhnham/docs/qa/evidence/perf-hotfix/purge/purge-sim.mjs:11)). Its branches are consistent with the 12 reported verdicts. Both files pass `node --check`; the tracked diff passes `git diff --check`.

No credential or token leak found. Credentials remain environment-only, response errors record only code/name, and neither the access token nor password enters logs or JSON output ([purge-probe.mjs](E:/Tunhuabinhnham/docs/qa/evidence/perf-hotfix/purge/purge-probe.mjs:134), [purge-probe.mjs](E:/Tunhuabinhnham/docs/qa/evidence/perf-hotfix/purge/purge-probe.mjs:165)). The simulator’s `sim-token` is synthetic.

No files were modified, and no network requests were made.

APPROVE
