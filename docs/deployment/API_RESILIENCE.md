# API resilience: stale-if-error, API timeout, upstream logs (branch `fix/production-api-resilience`)

## Incident 2026-11-14 (production web `da26f85d`)

- `GET /` and `/san-pham` returned HTTP 500 (Workers Logs 09:39:45Z, 09:39:47Z, 09:42:20Z, 09:42:31Z; reproduced 10:17:30Z and ~10:18Z with `CF-Cache-Status: BYPASS`, `Cache-Control: private, no-store, max-age=0`, 0.5–0.9 s). Recovered by ~10:19Z (`CF-Cache-Status: EXPIRED` then 200).
- The 500 is `src/app/(public)/error.tsx`, the error state that has existed since 859efe9. It is shown when the products API call fails. The production stack `async Promise.all (index 0)` matches `src/app/(public)/page.tsx` line 18, where index 0, `publicApi.products(...)`, is the only uncaught call on the home page. This was not checked against a source map: the production bundle is not available locally.
- Render at 10:17:35Z: `/health/live` took 44.6 s (`rndr-id 36cc5764-c981-408e`), which is a Free cold start. The Worker's own Render responses were **not logged** by `da26f85d`, so their status (429, 5xx, or a cold-start refusal) is not proven. A 429 to Cloudflare egress was observed earlier (`rndr-id 86e8d3a9-e6c7-4b31`, `cf-ray a59f97410e77dd4b-HKG`).
- Why the site "used to work": public pages are edge-cached for 12 h, so most visits never reach Render. Once an entry expires, the next visit renders again. **`s-maxage` in `Cache-Control` disables `stale-if-error` and Cloudflare's default stale-on-error** ("If your response does carry `s-maxage`, `must-revalidate`, or `proxy-revalidate`, `stale-if-error` is disabled regardless of the directive's value or the default", developers.cloudflare.com/workers/cache/configuration/). So an expired page plus a Render failure meant a 500 for every visitor, although a good copy was in the cache. Each Worker version also starts with an empty cache partition, so after a deploy every page needs Render once.
- Keepalive cannot prevent this. Cloudflare pings run at :22/:52 (30 min apart, while Render Free sleeps after 15 min idle) and get 429 from Render. GitHub schedule pings fired only twice in about 24 h.

## Change

1. **Edge lifetime moved to `Cloudflare-CDN-Cache-Control: public, max-age=43200, stale-if-error=259200`.**
   - `Cache-Control` is now `public, max-age=0`, so browsers still revalidate every time.
   - Workers Cache prefers the CDN header and strips it before the client.
   - Fresh time is unchanged at 12 h. After that, **only while the Worker errors** (500 from error.tsx, a throw, a timeout), the last good page is served for up to 72 h, with `Cf-Cache-Status: STALE`.
2. **Correctness of stale pages.**
   - Every admin save already calls `PublicCache.purge()` (tag `public-html`). A purge **deletes** entries, stale ones included ("Deleted … the next matching request is a cache miss"), so a hidden, deleted or repriced product cannot come back from the stale copy.
   - A stale page can only differ from the database if the data changed without an admin save (direct SQL) or the purge failed. A failed purge already shows the admin the "chưa thể làm mới cache công khai" warning.
   - Errors, fallback (degraded) renders and every private response are never stored. `finalHeaders` also strips `Cloudflare-CDN-Cache-Control` / `CDN-Cache-Control` from private responses, because that header would otherwise override `private`.
   - Images are unchanged.
3. **`apiFetch` timeout:** `AbortSignal.timeout(API_TIMEOUT_MS || 60000)`. Observed cold starts were 35–46 s, so 60 s leaves room for one. A hung Render request now ends, the page fails, and the stale copy can be served. The 2026-11-08 outage had 120 s hangs.
4. **Upstream failure logs (Workers Logs):** one JSON line per 429/5xx/network/timeout/invalid-JSON:

   ```json
   {"event":"api_upstream_error","path":"/products","category":"rate_limited","status":429,"durationMs":64,"rndrId":"…"}
   ```

   - The path is logged without its query (search text). No headers, cookies or body are logged.
   - 404 and other real answers are not logged, to keep log volume small.
   - Filter Workers Logs on `api_upstream_error` to see what Render answered during the next outage.
5. **Stale notice.** When the cached entrypoint's response carries `Cf-Cache-Status: STALE` and is HTML, the gateway prepends a `role="status"` line with HTMLRewriter: "Thông tin có thể chưa được cập nhật mới nhất. Vui lòng liên hệ cửa hàng để xác nhận giá và tình trạng hàng."
   - Unit-tested with a fake rewriter.
   - **UNVERIFIED on Cloudflare:** that `Cf-Cache-Status` reaches the gateway. If it does not, nothing is added; the page is still the stale copy.
   - Client navigations (RSC) get no notice.
   - **Owner decision before merge:** accept the 72 h stale window. A price changed directly in the database (not through Admin, so no purge) can show for up to 12 h + 72 h. Shorten `stale-if-error` if that is too long.

## Not verifiable locally (owner, on a preview, before production)

Also verify that the stale notice appears on a `STALE` response.

Local workerd has no Workers Cache, so `STALE` serving and the header precedence can only be proven on Cloudflare.

1. Upload a preview: `npx wrangler versions upload` from `apps/web`, with the production `.env.production.local` build and **no** `NEXT_PUBLIC_*` overrides in the shell.
2. Warm a key twice: `/san-pham?probe=<random>`. Expect `Cf-Cache-Status: HIT`, `Cache-Control: public, max-age=0`, and **no** `Cloudflare-CDN-Cache-Control` at the client.
3. Prove the stale-on-error path. Expiry takes 12 h, so the practical proof is to watch real outages after the release: an expired key plus a Render failure must give `STALE` and 200, not 500.
4. Purge proof as in `EDGE_CACHE_12H.md` §4: after an admin save, the warmed key must be a MISS or young.

## Deploy and rollback (owner only, after approval)

- **Deploy.** Build and deploy as in `EDGE_CACHE_12H.md` §6, step 3, from `apps/web` on the merged commit. Deploy while Render is warm, then open `/`, `/san-pham`, `/tin-tuc`, `/lien-he`, `/gioi-thieu` once each to fill the new (empty) cache partition.
- **Rollback.** `npx wrangler versions deploy da26f85d-8650-42b5-a256-feb0c54afce8@100% -y` from `apps/web`. Its own cache partition still holds its old entries until they expire.
- **Kill switch for stale serving.** An admin save, which purges everything, removes every stale entry at once. For a permanent off switch, set `stale-if-error=0` in `EDGE_CDN_CACHE_CONTROL` and deploy a new version.
