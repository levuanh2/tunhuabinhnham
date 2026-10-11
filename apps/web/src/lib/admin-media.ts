import { adminFetch } from "@/lib/admin-api";
import type { MediaAsset } from "@/types/api";

export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const BRANDING_TYPES = [...IMAGE_TYPES, "image/x-icon"] as const;

export function validateMediaFile(file: File, allowIcon = false): string | null {
  const accepted: readonly string[] = allowIcon ? BRANDING_TYPES : IMAGE_TYPES;
  if (!accepted.includes(file.type)) return allowIcon
    ? "Chỉ chấp nhận JPEG, PNG, WebP hoặc ICO"
    : "Chỉ chấp nhận JPEG, PNG hoặc WebP";
  if (file.size === 0) return "Tệp ảnh đang trống";
  if (file.size > MAX_MEDIA_BYTES) return "Ảnh không được vượt quá 8 MiB";
  return null;
}

export async function uploadAdminMedia(bucket: string, file: File): Promise<MediaAsset> {
  const body = new FormData();
  body.append("file", file);
  return adminFetch<MediaAsset>(`/media?bucket=${encodeURIComponent(bucket)}`, { method: "POST", body });
}

export async function deleteAdminMedia(media: Pick<MediaAsset, "id"> | { url: string }): Promise<void> {
  const path = "id" in media
    ? `/media/${encodeURIComponent(media.id)}`
    : `/media?url=${encodeURIComponent(media.url)}`;
  await adminFetch<void>(path, { method: "DELETE" });
}

export async function cleanupMediaUrls(urls: Iterable<string>): Promise<string[]> {
  const failures: string[] = [];
  for (const url of new Set(urls)) {
    try { await deleteAdminMedia({ url }); }
    catch { failures.push(url); }
  }
  return failures;
}
