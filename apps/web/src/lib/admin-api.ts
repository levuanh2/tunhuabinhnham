import { createClient } from "@/lib/supabase/client";

/** The API refused the request; `message` is the API's fixed error text (e.g. "Slug already exists"). */
export class AdminApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** The change is saved, but public pages still show the old version. Never retry the save on this error. */
export class CacheRefreshError extends Error {
  constructor() { super("Nội dung đã lưu nhưng chưa thể làm mới cache công khai"); }
}

export async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Phiên đăng nhập đã hết hạn");
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${data.session.access_token}`);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin${path}`, { ...init, cache: "no-store", headers });
  if (response.status === 401) { await supabase.auth.signOut({ scope: "local" }); throw new Error("Phiên đăng nhập đã hết hạn"); }
  if (!response.ok) { const payload = await response.json().catch(() => null); throw new AdminApiError(payload?.error?.message ?? "Yêu cầu không thành công", response.status); }
  // An upload is not public until saved content uses it; a media DELETE must purge the cached transformed image.
  if (init?.method && init.method !== "GET" && !(path.startsWith("/media") && init.method !== "DELETE")) {
    const revalidation = await fetch("/api/revalidate", {
      method: "POST",
      headers: { Authorization: `Bearer ${data.session.access_token}` },
    }).catch(() => undefined);
    if (!revalidation?.ok) throw new CacheRefreshError();
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
