import Link from "next/link";

export function SiteFooter() {
  return <footer className="bg-[#10213f] py-14 text-white">
    <div className="shell grid gap-10 md:grid-cols-[1.6fr_1fr_1fr]">
      <div><p className="display text-3xl">Tủ Nhựa Bình Nhâm</p><p className="mt-3 max-w-md text-slate-300">Không cần giỏ hàng phức tạp. Xem kỹ sản phẩm, giữ lại mã và trò chuyện trực tiếp với cửa hàng.</p></div>
      <div><p className="font-bold">Khám phá</p><div className="mt-4 grid gap-2 text-slate-300"><Link href="/san-pham">Sản phẩm</Link><Link href="/tin-tuc">Tin tức</Link><Link href="/gioi-thieu">Câu chuyện cửa hàng</Link></div></div>
      <div><p className="font-bold">Hỗ trợ</p><div className="mt-4 grid gap-2 text-slate-300"><Link href="/lien-he">Liên hệ</Link><Link href="/admin/login">Quản trị</Link></div></div>
    </div>
  </footer>;
}
