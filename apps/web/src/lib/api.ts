import type { Banner, Category, Page, Post, Product, SiteSettings } from "@/types/api";
import { markRenderDegraded } from "./edge-cache";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

// A hung request must end so the page can fail (and Workers Cache can serve its stale-if-error copy). Render Free cold
// starts took 35-46 s (2026-11-13/14), so the default leaves room for one. API_TIMEOUT_MS overrides it (e2e uses 5 s).
const timeoutMs = () => Number(process.env.API_TIMEOUT_MS) || 60_000;

/** One JSON line per upstream failure for Workers Logs: no query string (search text), headers or body. */
function logFailure(path: string, started: number, category: string, response?: Response) {
  console.warn(JSON.stringify({
    event: "api_upstream_error", path: path.split("?")[0], category, status: response?.status,
    durationMs: Date.now() - started, rndrId: response?.headers.get("rndr-id") ?? undefined,
  }));
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const started = Date.now();
  const response = await fetch(`${API_URL}${path}`, { signal: AbortSignal.timeout(timeoutMs()), ...init, headers: { "Content-Type": "application/json", ...init?.headers }, next: { revalidate: 60, tags: ["catalog"] }, }).catch(error => {
    markRenderDegraded(); logFailure(path, started, (error as Error)?.name === "TimeoutError" ? "timeout" : "network"); throw error; });
  // Any failure (404 included: a detail page then renders 404, which is never cached anyway) means the page
  // may show fallback content, so it must not be edge-cached.
  if (!response.ok) {
    markRenderDegraded();
    if (response.status === 429 || response.status >= 500) logFailure(path, started, response.status === 429 ? "rate_limited" : "upstream_5xx", response);
    const payload = await response.json().catch(() => null); throw new ApiError(response.status, payload?.error?.message ?? "Không thể tải dữ liệu"); }
  return (response.json() as Promise<T>).catch(error => { markRenderDegraded(); logFailure(path, started, (error as Error)?.name === "TimeoutError" ? "timeout" : "invalid_json", response); throw error; });
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
