import Link from "next/link";

/** Body of every 404 page; the status code stays 404 (Next's notFound / not-found.tsx). */
export function NotFoundContent() {
  return <div className="shell py-16 md:py-24">
    <div className="mx-auto max-w-xl rounded-xl border border-dashed border-line-strong px-6 py-14 text-center">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-soft">Lỗi 404</p>
      <h1 className="display mt-3 text-3xl md:text-4xl">Không tìm thấy trang</h1>
      <p className="mx-auto mt-3 max-w-md text-ink-soft">Trang bạn tìm có thể đã được đổi địa chỉ hoặc không còn hiển thị. Bạn có thể xem các mẫu tủ đang bán hoặc quay về trang chủ.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/san-pham" className="button min-h-12 px-6">Xem sản phẩm</Link>
        <Link href="/" className="button secondary min-h-12 px-6">Về trang chủ</Link>
      </div>
    </div>
  </div>;
}
