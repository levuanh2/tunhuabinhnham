codex
## Findings

### P1 — Deleted or unpublished images can remain publicly available for one year

The new image response is cached for `31,536,000` seconds, but cache invalidation is not guaranteed after an image becomes non-public.

- Image cache lifetime: [apps/web/src/lib/edge-cache.ts:87](E:/Tunhuabinhnham/apps/web/src/lib/edge-cache.ts:87)
- Media mutations explicitly skip revalidation: [apps/web/src/lib/admin-api.ts:23](E:/Tunhuabinhnham/apps/web/src/lib/admin-api.ts:23)
- Image cleanup occurs after the content save and its purge: [apps/web/src/features/admin/product-form.tsx:125](E:/Tunhuabinhnham/apps/web/src/features/admin/product-form.tsx:125)

This creates three failure paths:

- An image request can refill the cache after the content-save purge but before storage deletion.
- A direct media deletion never purges the image cache.
- If an unpublish/hide succeeds but its purge fails, the transformed image remains publicly retrievable for up to one year. The previous documented backstop was five minutes.

UUID4 paths and `upsert: false` do make the stored bytes immutable, as shown at [apps/api/app/api/v1/admin.py:563](E:/Tunhuabinhnham/apps/api/app/api/v1/admin.py:563) and [apps/api/app/api/v1/admin.py:576](E:/Tunhuabinhnham/apps/api/app/api/v1/admin.py:576). Publication state is not immutable, however.

Fix by retaining a bounded shared-cache TTL, removing the browser-facing `immutable` guarantee where revocation matters, and purging after successful media deletion. Add a regression test for purge failure and the save→purge→delete race.

### P2 — `Accept: image/webp;q=0` is treated as WebP-capable

[apps/web/src/lib/edge-cache.ts:47](E:/Tunhuabinhnham/apps/web/src/lib/edge-cache.ts:47)

The substring check accepts headers that mention WebP while explicitly refusing it, such as:

```http
Accept: image/png, image/webp;q=0
```

Because the stated cache key excludes `Accept`, that client can receive an already cached WebP body it cannot decode. Strings such as `image/webp2` also pass.

Parse media ranges and require an exact `image/webp` token with a quality value above zero. Add both cases to [apps/web/src/lib/edge-cache.test.ts:99](E:/Tunhuabinhnham/apps/web/src/lib/edge-cache.test.ts:99).

### P2 — The worker routing tests inspect source text instead of exercising behavior

[apps/web/src/lib/worker-cache-config.test.ts:39](E:/Tunhuabinhnham/apps/web/src/lib/worker-cache-config.test.ts:39)

These assertions prove that selected strings exist, but not that:

- credentialed image requests never invoke `PublicCache`;
- a thrown or streamed-body failure becomes an uncached 302;
- a 5xx with no valid fallback remains private;
- 200 responses with `Set-Cookie` or non-image content stay uncached;
- GET and HEAD behave correctly through the cache entrypoint.

This cache boundary carries the main isolation guarantee, so it needs behavioral tests with mocked entrypoints, plus a workerd/preview check where possible. Cloudflare documents that GET and HEAD share an entry and a cold HEAD is internally converted to GET, so the current HEAD flow is otherwise consistent with the platform contract. [Cloudflare cache limitations](https://developers.cloudflare.com/workers/cache/limitations/)

## Other requested checks

- Credential isolation: the gateway’s image branch still calls `isEdgeCacheableRequest`; Supabase cookies and `Authorization` therefore go through the uncached path. I found no route by which a credentialed response reaches `PublicCache`.
- Personalization: cached image responses are limited to anonymous image requests, status 200, `image/*`, and no `Set-Cookie`. Nothing in the optimizer path is user-personalized.
- Fallback URL: I found no open redirect or SSRF. URL parsing canonicalizes ordinary and encoded dot traversal before the pathname check. The exact host suffix rejects lookalikes, IDNs, trailing dots, userinfo, and ports; backslashes cannot move the request to another accepted host.
- Error control flow: thrown transforms become a private 502 inside `PublicCache`, then a private 302 at the gateway when the fallback is valid. Returned 5xx responses follow the same fallback path. Redirects, 4xx/5xx, non-images, and `Set-Cookie` responses are not stored.
- Prefetch: `prefetch={false}` is valid for Next App Router and disables both viewport and hover prefetching. No `router.prefetch`, `useLinkStatus`, or other prefetch-dependent code exists in the app. The trade-off is a server round trip on every click, which matches the measured intent. [Next.js Link documentation](https://nextjs.org/docs/app/api-reference/components/link)
- Test strengths: the helper tests cover credentials, status, content type, `Set-Cookie`, common redirect tricks, and the public-link policy well. The missing cases are the two P2 items above.

Verification: TypeScript passed. Scoped ESLint passed for all changed TypeScript files. Vitest could not start because the read-only environment blocked esbuild spawning with `EPERM`; no test assertion failed. No files were modified and no external systems were contacted.

REQUEST_CHANGES
