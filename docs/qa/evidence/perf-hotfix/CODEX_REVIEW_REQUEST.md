Independent code review, read-only. Do not modify files, do not run deploy/upload/push, do not contact production.

Repository: E:\Tunhuabinhnham. Review commit 4bd2292 against its parent e681cca (the code live in production as Cloudflare Worker version f4fd8f1a): `git diff e681cca 4bd2292`.

Context: Next.js 16.3.8 on Cloudflare Workers via OpenNext 1.20.10. worker.ts is a gateway with an uncached default entrypoint and a PublicCache entrypoint that has Workers Cache enabled (cache key = path+query only; cookies/Authorization/Accept are NOT in the key). V1.1 cache isolation rule: credentials (Supabase sb-*-auth-token cookies or Authorization) must never reach the cached entrypoint, and nothing personalised may be cached.

Incident being fixed: (1) /_next/image was served "private, no-store", so every view re-transformed every image; OpenNext's 7 s AbortSignal on the source fetch also covers the streamed body, so slow transforms throw IMAGES_TRANSFORM_ERROR 9523 "aborted due to timeout" as uncaught exceptions. (2) Every public route is dynamic, but each page view fired ~22 Link viewport prefetches (full renders + backend calls) the clicks never reused.

The change: anonymous WebP-capable /_next/image requests go through PublicCache and are stored "public, max-age=31536000, immutable" with the existing purge tag; failed transforms (throw or 5xx) redirect 302 to the original upload only when it is an https *.supabase.co /storage/v1/object/public/ URL; public <Link>s get prefetch={false}.

Please check and report findings with severity P0-P3 and file:line:
- Can a credentialed or personalised response ever be stored or served from the public cache? Can the Accept-less cache key serve a format a client cannot decode?
- Is imageFallbackUrl an open redirect or SSRF in any URL form (encoding, userinfo, ports, IDN, backslashes, path traversal)?
- Are upload URLs really immutable (apps/api upload: uuid4 path, upsert false)? Any case where a cached image outlives a deletion in a way that violates "unpublished/soft-deleted data must not be public"?
- Correctness of the PublicCache .catch path and fetchImage control flow; any response that would now be cached that should not be (status, content-type, Set-Cookie, HEAD).
- Is disabling prefetch on all public Links correct for Next 16 dynamic routes, and is anything else in the app relying on prefetch?
- Test quality of the added tests.
End with a verdict line: APPROVE or REQUEST_CHANGES.
