export function formatDate(value?: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("vi-VN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(value));
}
