import { publicApi } from "./api";

/** Shown only when site_settings cannot be loaded; the CMS store_name is the source of truth. */
export const FALLBACK_STORE_NAME = "Tủ Nhựa Bình Nhâm";

export async function getStoreName(): Promise<string> {
  try { return (await publicApi.settings()).store_name || FALLBACK_STORE_NAME; } catch { return FALLBACK_STORE_NAME; }
}
