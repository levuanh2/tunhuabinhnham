# Code Review: V1.1 cache isolation hotfix

## 📋 Review Summary

| Task ID | Category | File | Fix | Description |
| --- | --- | --- | --- | --- |
| WARN-001 | Runtime verification | `apps/web/src/lib/worker-cache-config.test.ts:15` | test-first | Run the real remote-preview MISS/HIT/BYPASS and purge replay matrix before release. |

### Review Recommendation

The source patch can be committed and uploaded as a preview, but it cannot pass the N preview gate until the remote cache and real-backend Admin checks pass.

## Recommended Changes

### 🟡 Warnings

**WARN-001** `apps/web/src/lib/worker-cache-config.test.ts:15` Local workerd proves gateway routing and private response policy, but it does not expose `CF-Cache-Status` or prove a shared-cache hit. A new remote preview must show anonymous MISS→HIT, credential BYPASS after warm cache, auth-first isolation, successful purge→MISS, and unchanged static assets before release. **Fix:** test-first.
