export function formatPrice(value?: string | null) {
  if (!value) return "Liên hệ";
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(Number(value));
}
