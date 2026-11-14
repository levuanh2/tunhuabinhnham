import type { Banner, Category, Page, Post, Product, SiteSettings } from "@/types/api";
import { markRenderDegraded, markRenderUnavailable } from "./edge-cache";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

// A hung request must end so the page can fail (and Workers Cache can serve its stale-if-error copy). Render Free cold
// starts took 35-46 s (2026-11-13/14), so the default leaves room for one. API_TIMEOUT_MS overrides it (e2e uses 5 s).
const timeoutMs = () => Number(process.env.API_TIMEOUT_MS) || 60_000;

/** The API could not answer: the render must not be cached (a router request then becomes a 500, worker.ts), and
 * Workers Logs get one JSON line without query string (search text), headers or body. */
function upstreamFailed(path: string, started: number, category: string, response?: Response) {
  markRenderUnavailable();
  console.warn(JSON.stringify({
    event: "api_upstream_error", path: path.split("?")[0], category, status: response?.status,
    durationMs: Date.now() - started, rndrId: response?.headers.get("rndr-id") ?? undefined,
  }));
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const started = Date.now();
  // The timeout always applies; a caller's own signal can only end the request sooner, never disable the timeout.
  const signal = init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs())]) : AbortSignal.timeout(timeoutMs());
  // A failure the caller caused (its signal aborted) is not an upstream failure: degraded, not logged as one.
  const failed = (error: unknown, category: string, response?: Response) => {
    if (init?.signal?.aborted) markRenderDegraded();
    else upstreamFailed(path, started, (error as Error)?.name === "TimeoutError" ? "timeout" : category, response);
    throw error;
  };
  const response = await fetch(`${API_URL}${path}`, { ...init, signal, headers: { "Content-Type": "application/json", ...init?.headers }, next: { revalidate: 60, tags: ["catalog"] }, })
    .catch(error => failed(error, "network"));
  // Any failure (404 included: a detail page then renders 404, which is never cached anyway) means the page
  // may show fallback content, so it must not be edge-cached.
  if (!response.ok) {
    if (response.status === 429 || response.status >= 500) upstreamFailed(path, started, response.status === 429 ? "rate_limited" : "upstream_5xx", response);
    else markRenderDegraded();
    const payload = await response.json().catch(() => null); throw new ApiError(response.status, payload?.error?.message ?? "Không thể tải dữ liệu"); }
  return (response.json() as Promise<T>).catch(error => failed(error, "invalid_json", response));
}

// The backend could not answer (network, rate limit, 5xx): the page shows the error boundary instead of
// pretending the catalogue is empty. Other 4xx (bad filter, unknown slug) are real answers.
export const isUnavailable = (error: unknown) => !(error instanceof ApiError) || error.status === 429 || error.status >= 500;

export const publicApi = {
  products: (query = "") => apiFetch<Page<Product>>(`/products${query ? `?${query}` : ""}`),
  // The API answers an old slug with a 301 to the current one (query kept); fetch follows it. `related=4`: the
  // product page's "same category" products in the same response (and the same database statements).
  product: (slug: string) => apiFetch<Product & { related?: Product[] }>(`/products/${encodeURIComponent(slug)}?related=4`),
  categories: () => apiFetch<Category[]>("/categories"),
  posts: () => apiFetch<Page<Post>>("/posts"),
  banners: () => apiFetch<Banner[]>("/banners"),
  settings: () => apiFetch<SiteSettings>("/site-settings"),
};
