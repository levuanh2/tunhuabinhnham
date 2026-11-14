import { AsyncLocalStorage } from "node:async_hooks";

/*
 * Workers Cache policy (worker.ts). The cache key is path + query only: cookies, Authorization and the host
 * are NOT part of it, so a response marked public here is served to every visitor on every hostname.
 * Only anonymous, fully rendered public pages and transformed public uploads may ever get the public header.
 */

export const EDGE_CACHE_TAG = "public-html";
// Browsers revalidate every time (max-age=0). The edge lifetime lives only in Cloudflare-CDN-Cache-Control, which
// Workers Cache prefers over Cache-Control and strips before the client: `s-maxage` there would disable stale-if-error.
export const EDGE_CACHE_CONTROL = "public, max-age=0";
// 12 h fresh: the owner accepts public pages up to ~12 h stale to spare Render Free (2026-10-24). Then, only while
// the Worker errors (Render 429/5xx/timeout renders error.tsx = 500), the last good page is served for up to 72 h
// more instead of the error page. Admin saves purge the tag through /api/revalidate, which deletes entries (stale
// ones too), so a hidden or changed product never comes back from here. Emergency removal: docs/deployment/EDGE_CACHE_12H.md.
export const EDGE_CDN_CACHE_CONTROL = "public, max-age=43200, stale-if-error=259200";
// Router (RSC) payloads are never served stale: a stale payload would render without the stale notice. When one
// cannot be rendered the Worker answers 500 (worker.ts), the router falls back to a full page load, and that HTML
// may come from the stale copy with the notice. stale-if-error=0 must be explicit: without it Workers Cache serves
// stale on errors indefinitely.
export const EDGE_CDN_CACHE_CONTROL_RSC = "public, max-age=43200, stale-if-error=0";
export const EDGE_CDN_HEADER = "Cloudflare-CDN-Cache-Control";

const PUBLIC_PATH = /^\/(?:|san-pham(?:\/[^/]+)?|tin-tuc(?:\/[^/]+)?|lien-he|gioi-thieu)$/;
const RSC_HEADERS = ["rsc", "next-router-prefetch", "next-router-state-tree", "next-router-segment-prefetch"];
const SESSION_COOKIE = /(?:^|;\s*)(?:__Host-|__Secure-)?sb-[^=;\s]+-auth-token(?:\.(?:0|[1-9]\d*))?=/;

type RenderState = { degraded: boolean; unavailable?: boolean };
// One instance shared by worker.ts and the Next server bundle (they are bundled separately).
const KEY = Symbol.for("tunhuabinhnham.render-state");
const shared = globalThis as typeof globalThis & { [KEY]?: AsyncLocalStorage<RenderState> };
export const renderState = (shared[KEY] ??= new AsyncLocalStorage<RenderState>());

/** apiFetch calls this when it falls back: a page built from fallback data must never be cached. */
export function markRenderDegraded() {
  const state = renderState.getStore();
  if (state) state.degraded = true;
}

/** apiFetch calls this when the API could not answer (429, 5xx, network, timeout, unreadable body). */
export function markRenderUnavailable() {
  const state = renderState.getStore();
  if (state) { state.degraded = true; state.unavailable = true; }
}

/** Router (RSC) request: Next signs `_rsc` with a hash of the router headers and 307s on a mismatch,
 * so the URL alone identifies the variant and a forged combination is never stored. */
export const isRscRequest = (request: Request) => request.headers.get("rsc") === "1" && new URL(request.url).searchParams.has("_rsc");

/** Credentials must be detected by the uncached gateway before it calls the cached entrypoint. */
export function hasRequestCredentials(request: Request): boolean {
  const headers = request.headers;
  return headers.has("authorization") || SESSION_COOKIE.test(headers.get("cookie") ?? "");
}

/** An explicit `image/webp` media range with q > 0 (not `image/webp;q=0`, not `image/webp2`). */
const acceptsWebp = (accept: string) => accept.split(",").some(range => {
  const [type, ...params] = range.split(";").map(part => part.trim().toLowerCase());
  const q = params.find(param => param.startsWith("q="));
  return type === "image/webp" && (q === undefined || Number(q.slice(2)) > 0);
});

export const isImageRequest = (request: Request) => new URL(request.url).pathname === "/_next/image";

export function isEdgeCacheableRequest(request: Request): boolean {
  if (hasRequestCredentials(request)) return false;
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const url = new URL(request.url);
  const headers = request.headers;
  // The cache key ignores Accept and images.formats is WebP-only, so only WebP-capable clients share an entry.
  if (isImageRequest(request)) return acceptsWebp(headers.get("accept") ?? "");
  if (!PUBLIC_PATH.test(url.pathname)) return false;
  const rsc = isRscRequest(request);
  if (!rsc && (url.searchParams.has("_rsc") || RSC_HEADERS.some(name => headers.has(name)))) return false;
  return true;
}

/** Headers that make the response edge-cacheable, or null to keep Next's private/no-store headers. */
const PRODUCT_PATH = /^\/san-pham\/[^/]+$/;

/** The product page's own redirect from an old URL to the current one (permanentRedirect, a 308).
 * Only that one may become a 301: any other 308 keeps its method-preserving status. */
export function isProductMove(request: Request, response: Response): boolean {
  if (response.status !== 308 || (request.method !== "GET" && request.method !== "HEAD")) return false;
  const from = new URL(request.url);
  const location = response.headers.get("location");
  if (!location || !PRODUCT_PATH.test(from.pathname)) return false;
  const to = new URL(location, from);
  return to.origin === from.origin && PRODUCT_PATH.test(to.pathname) && to.pathname !== from.pathname;
}

export function edgeCacheHeaders(response: Response, degraded: boolean, rsc = false): Headers | null {
  if (degraded || response.status !== 200 || response.headers.has("set-cookie")) return null;
  if (!(response.headers.get("content-type") ?? "").startsWith(rsc ? "text/x-component" : "text/html")) return null;
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", EDGE_CACHE_CONTROL);
  headers.set(EDGE_CDN_HEADER, rsc ? EDGE_CDN_CACHE_CONTROL_RSC : EDGE_CDN_CACHE_CONTROL);
  headers.set("Cache-Tag", EDGE_CACHE_TAG);
  // Every router header must partition the cache, so no variant answers a request with other router headers.
  const vary = (headers.get("vary") ?? "").toLowerCase().split(",").map(name => name.trim());
  const missing = RSC_HEADERS.filter(name => !vary.includes(name));
  if (missing.length) headers.append("Vary", missing.join(", "));
  return headers;
}

/** Uploads get a fresh UUID path and are never overwritten, but an image can stop being public (deleted,
 * unpublished), so lifetimes stay bounded: 1 h in browsers, 1 day at the edge, and admin saves purge the tag. */
export function imageCacheHeaders(response: Response): Headers | null {
  if (response.status !== 200 || response.headers.has("set-cookie")) return null;
  if (!(response.headers.get("content-type") ?? "").startsWith("image/")) return null;
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "public, max-age=3600, s-maxage=86400");
  headers.set("Cache-Tag", EDGE_CACHE_TAG);
  return headers;
}

/** The original upload to send the browser to when the transform fails, limited to the next.config
 * remotePatterns source (https Supabase public storage) so it is never an open redirect. */
export function imageFallbackUrl(request: Request): string | null {
  try {
    const source = new URL(new URL(request.url).searchParams.get("url") ?? "");
    const allowed = source.protocol === "https:" && /^[a-z0-9-]+\.supabase\.co$/.test(source.host) && !source.username && !source.password
      && source.pathname.startsWith("/storage/v1/object/public/");
    return allowed ? source.href : null;
  } catch {
    return null;
  }
}

type CachePurgeResult = { success: boolean };
type CachePurger = { cache?: { purge(options: { tags: string[] }): Promise<CachePurgeResult> } };

/** Purges every cached public page. Returns false when the Worker has no cache API (local dev, cache disabled). */
export async function purgeEdgeCache(ctx: unknown): Promise<boolean> {
  const cache = (ctx as CachePurger | undefined)?.cache;
  if (!cache) return false;
  const result = await cache.purge({ tags: [EDGE_CACHE_TAG] });
  return result.success;
}

/** Shown on a page Workers Cache served from its stale-if-error copy because rendering failed (Render down):
 * the stored page can be older than 12 h, so prices and stock may have changed. Client navigations (RSC) keep
 * the page already on screen. ponytail: relies on Cf-Cache-Status reaching the gateway; verify STALE on a preview. */
export const STALE_NOTICE = '<p role="status" style="margin:0;padding:8px 16px;background:#fff7e6;color:#7a4b00;font-size:14px;line-height:1.4;text-align:center">'
  + "Thông tin có thể chưa được cập nhật mới nhất. Vui lòng liên hệ cửa hàng để xác nhận giá và tình trạng hàng.</p>";
