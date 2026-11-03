codex
## Findings

- **P2 — `apps/web/src/lib/admin-media.ts:35`**: A successful media deletion followed by a failed `/api/revalidate` call is removed from the cleanup queue and reported as success. Consequently, all callers show only their normal success toast (`product-form.tsx:125-129`, banner `page.tsx:25`, settings `page.tsx:31-36`, posts `page.tsx:68-72`), although visitors may continue seeing the deleted image for up to 24 hours. Return a separate stale-cache signal or show one warning without retrying the already-completed deletion; add a test covering the warning and multiple cleanup items.

No P0, P1, or P3 findings.

## Round-1 verification

- **Year-long stale images and delete race:** Resolved. Images now use `max-age=3600, s-maxage=86400` without `immutable`, and media deletion purges after the DELETE completes. A failed purge is bounded to one day at the edge and one hour in browsers. Cloudflare documents that `s-maxage` limits edge lifetime and `Cache-Tag` supports bulk purge. [Cloudflare Workers cache configuration](https://developers.cloudflare.com/workers/cache/configuration/)
- **Invalid Accept matching:** Resolved. Parsing requires an exact `image/webp` media range with a positive quality value; the cited `q=0` and `image/webp2` cases are covered.
- **Source-string-only routing tests:** Resolved. `worker-image.test.ts` exercises the actual worker gateway and `PublicCache` entrypoint behavior.
- **Vitest alias leakage:** No issue found. The stand-ins are referenced only by `vitest.config.ts`; production Next/OpenNext configuration does not import that file.

TypeScript and targeted ESLint checks passed. Vitest could not start because the read-only sandbox blocked its esbuild child process with `EPERM`. No full build was run because it writes build artifacts. Concurrent uncommitted admin-media edits were excluded; the review remained pinned to `f974ae9`.

REQUEST_CHANGES
