// Same rules as the API (`schemas/catalog.py`): lowercase ASCII words joined by single hyphens.
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MAX = 260;
export const SKU_PATTERN = /^[A-Za-z0-9._-]+$/;
const SKU_MAX = 80;

const trimHyphens = (value: string) => value.replace(/^-+|-+$/g, "");

/** "Tủ nhựa 5 tầng màu trắng" → "tu-nhua-5-tang-mau-trang". Returns "" when nothing usable is left. */
export function toSlug(value: string, max = SLUG_MAX) {
  const ascii = value.toLowerCase().replace(/đ/g, "d").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return trimHyphens(trimHyphens(ascii.replace(/[^a-z0-9]+/g, "-")).slice(0, max));
}

/** "tu-nhua", 2 → "tu-nhua-2", shortening the base so the result stays within `max`. */
export function withSuffix(value: string, n: number, max = SLUG_MAX) {
  const tail = `-${n}`;
  return `${trimHyphens(value.slice(0, max - tail.length))}${tail}`;
}

/** Product code derived from the slug when the admin leaves it empty: "tu-nhua-5-tang" → "TN-TU-NHUA-5-TANG". */
export const skuFromSlug = (slug: string) => trimHyphens(`TN-${slug}`.toUpperCase().slice(0, SKU_MAX));

/** "1.250.000", "1 250 000" or "1250000" -> "1250000"; "" stays "" (price on request); null = not a price. */
export function toPrice(value: string) {
  const text = value.trim();
  if (!text) return "";
  if (/^\d{1,3}(?:[.,\s]\d{3})+$/.test(text)) return text.replace(/[.,\s]/g, "");
  return /^\d+(?:\.\d{1,2})?$/.test(text) ? text : null;
}
