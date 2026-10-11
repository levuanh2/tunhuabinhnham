import Image from "next/image";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { MobileNav, NavLinks } from "./site-nav";

const navItems = [
  { href: "/san-pham", label: "Sản phẩm" },
  { href: "/tin-tuc", label: "Tin tức" },
  { href: "/gioi-thieu", label: "Giới thiệu" },
  { href: "/lien-he", label: "Liên hệ" },
];

export function SiteHeader({ storeName = "Tủ Nhựa Bình Nhâm", logoUrl }: { storeName?: string; logoUrl?: string | null }) {
  return <header className="sticky top-0 z-40 border-b border-line bg-bg/90 pt-[env(safe-area-inset-top)] backdrop-blur-md">
    <a href="#noi-dung" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">Bỏ qua điều hướng</a>
    <div className="shell flex h-14 items-center justify-between gap-2 lg:h-[72px] md:gap-4">
      <Link href="/" className="flex min-w-0 items-center gap-2.5">
        {logoUrl && <Image src={logoUrl} alt="" width={40} height={40} className="size-8 shrink-0 object-contain md:size-10" />}
        <span className="display truncate text-[1.25rem] leading-none min-[380px]:text-[1.375rem] md:text-2xl">{storeName}</span>
      </Link>
      <nav aria-label="Điều hướng chính" className="hidden lg:block"><NavLinks items={navItems} /></nav>
      <Link href="/lien-he" className="button sm hidden lg:inline-flex"><MessageCircle size={16} aria-hidden="true" />Nhắn tin</Link>
      <div className="-mr-2.5 lg:hidden"><MobileNav items={navItems} /></div>
    </div>
  </header>;
}
