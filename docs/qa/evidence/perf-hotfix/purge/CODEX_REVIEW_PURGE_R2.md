codex
P0: None.

P1: None.

P2:

- [purge-probe.mjs:57](E:/Tunhuabinhnham/docs/qa/evidence/perf-hotfix/purge/purge-probe.mjs:57) — Malformed `Age` and `CF-Ray` headers can still produce PASS. `Number("")`, negative values, or `Infinity` are accepted as ages; arbitrary non-null `CF-Ray` text is accepted as a colo. These values feed the PASS paths at lines 83–84 and 89–90. For example, `Age: Infinity` proves survival, while an empty or negative age can prove a purge after enough elapsed time. Validate `Age` as finite, non-negative decimal seconds and validate the `CF-Ray` structure; otherwise record the fields as null. Add simulator cases for malformed and missing evidence headers. **Fix:** test-first.

P3: None.

Round-1 verification:

- Rejected purges now check both the image and page: lines 122–126.
- Slow responses are no longer classified as old using send time: line 74 uses receipt time. Young-HIT proof uses the stricter send-time bound at line 75.
- Only an exact `MISS` or provably young `HIT` can prove a purge: lines 73–75 and 83–84. Other cache statuses cannot pass.
- Null colos cannot satisfy same-colo proof: lines 76 and 83.
- Production evidence has an absolute 280-second deadline inside the 300-second TTL: lines 77, 129, and 142.
- Login, logout, and purge have one attempt, manual redirects, and a 20-second timeout: lines 53 and 113.
- The return simulator now drifts through HKG, FRA, MAD, and KIX: lines 9–13.
- Network loss is modeled for production-only and all post-purge GETs: lines 35–36.
- The pre-event comment now correctly states one cold plus six warm samples: lines 20 and 107–109.
- The nine reported simulator outcomes match the intended gates.
- Credentials and access tokens do not flow into console output or the result object. Only status, selected cache headers, timings, samples, and sanitized cache-key descriptions are recorded.
- Both files pass `node --check`. I did not rerun the simulator because it writes a result file, contrary to the read-only constraint.

REQUEST_CHANGES
