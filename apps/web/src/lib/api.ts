import type { Banner, Category, Page, Post, Product, SiteSettings } from "@/types/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers }, next: { revalidate: 60, tags: ["catalog"] }, });
  if (!response.ok) { const payload = await response.json().catch(() => null); throw new ApiError(response.status, payload?.error?.message ?? "Không thể tải dữ liệu"); }
  return response.json() as Promise<T>;
}

export const publicApi = {
  products: (query = "") => apiFetch<Page<Product>>(`/products${query ? `?${query}` : ""}`),
  product: (slug: string) => apiFetch<Product>(`/products/${slug}`),
  categories: () => apiFetch<Category[]>("/categories"),
  posts: () => apiFetch<Page<Post>>("/posts"),
  banners: () => apiFetch<Banner[]>("/banners"),
  settings: () => apiFetch<SiteSettings>("/site-settings"),
};
