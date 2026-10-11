import Link from "next/link";
import { Menu, MessageCircle } from "lucide-react";
import Image from "next/image";

export function SiteHeader({ storeName = "Tủ Nhựa Bình Nhâm", logoUrl }: { storeName?: string; logoUrl?: string | null }) {
  return <header className="border-b border-slate-200 bg-white/95 sticky top-0 z-40 backdrop-blur">
    <div className="shell flex h-18 items-center justify-between gap-6">
      <Link href="/" className="display flex items-center gap-3 text-2xl">{logoUrl && <Image src={logoUrl} alt="" width={48} height={48} className="h-12 w-12 object-contain" />}<span>{storeName}</span></Link>
      <nav aria-label="Điều hướng chính" className="hidden items-center gap-7 font-medium md:flex">
        <Link href="/san-pham">Sản phẩm</Link><Link href="/tin-tuc">Tin tức</Link><Link href="/gioi-thieu">Giới thiệu</Link><Link href="/lien-he">Liên hệ</Link>
      </nav>
      <Link href="/lien-he" className="button hidden sm:inline-flex"><MessageCircle size={18} /> Nhắn tin</Link>
      <button className="md:hidden" aria-label="Mở menu"><Menu /></button>
    </div>
  </header>;
}
