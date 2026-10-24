import type { Banner, Category, Page, Post, Product, SiteSettings } from "@/types/api";
import { markRenderDegraded } from "./edge-cache";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers }, next: { revalidate: 60, tags: ["catalog"] }, }).catch(error => { markRenderDegraded(); throw error; });
  // Any failure (404 included: a detail page then renders 404, which is never cached anyway) means the page
  // may show fallback content, so it must not be edge-cached.
  if (!response.ok) {
    markRenderDegraded(); const payload = await response.json().catch(() => null); throw new ApiError(response.status, payload?.error?.message ?? "Không thể tải dữ liệu"); }
  return (response.json() as Promise<T>).catch(error => { markRenderDegraded(); throw error; });
}

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
