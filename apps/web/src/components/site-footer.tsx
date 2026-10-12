import { FALLBACK_STORE_NAME } from "@/lib/brand";
import Link from "next/link";
import type { SiteSettings } from "@/types/api";

export function SiteFooter({ settings }: { settings?: SiteSettings | null }) {
  const storeName = settings?.store_name ?? FALLBACK_STORE_NAME;
  const facebook = settings?.facebook_url;
  return <footer className="mt-auto bg-ink pb-[env(safe-area-inset-bottom)] text-[#d9d3cb]">
    <div className="shell grid gap-8 py-12 md:grid-cols-[1.4fr_1fr_1fr] md:gap-10 md:py-16">
      <div>
        <p className="display text-3xl text-white">{storeName}</p>
        <p className="mt-3 max-w-sm leading-7">Tủ nhựa, tủ quần áo và đồ lưu trữ cho từng góc trong nhà. Xem mẫu trên website, nhắn tin để được báo giá và giao hàng.</p>
      </div>
      <nav aria-label="Liên kết chân trang">
        <p className="text-sm font-semibold text-white">Khám phá</p>
        <ul className="mt-2 grid md:mt-4 md:gap-2.5">
          <li><Link className="inline-flex min-h-11 items-center hover:text-white md:min-h-0" href="/san-pham">Sản phẩm</Link></li>
          <li><Link className="inline-flex min-h-11 items-center hover:text-white md:min-h-0" href="/tin-tuc">Tin tức</Link></li>
          <li><Link className="inline-flex min-h-11 items-center hover:text-white md:min-h-0" href="/gioi-thieu">Giới thiệu</Link></li>
          <li><Link className="inline-flex min-h-11 items-center hover:text-white md:min-h-0" href="/lien-he">Liên hệ</Link></li>
        </ul>
      </nav>
      <div>
        <p className="text-sm font-semibold text-white">Cửa hàng</p>
        <dl className="mt-2 grid md:mt-4 md:gap-2.5">
          {settings?.hotline && <div><dt className="sr-only">Hotline</dt><dd><a className="inline-flex min-h-11 items-center hover:text-white md:min-h-0" href={`tel:${settings.hotline.replace(/\s/g, "")}`}>{settings.hotline}</a></dd></div>}
          {settings?.address && <div><dt className="sr-only">Địa chỉ</dt><dd className="py-2.5 md:py-0">{settings.address}</dd></div>}
          {facebook && <div><dt className="sr-only">Fanpage</dt><dd><a className="inline-flex min-h-11 items-center hover:text-white md:min-h-0" href={facebook} target="_blank" rel="noopener noreferrer">Fanpage Facebook</a></dd></div>}
        </dl>
      </div>
    </div>
    <div className="border-t border-white/10">
      <div className="shell flex flex-wrap items-center justify-between gap-3 py-5 text-sm text-[#a9a197]">
        <p>© {new Date().getFullYear()} {storeName}</p>
        <Link className="inline-flex min-h-11 items-center hover:text-white md:min-h-0" href="/admin/login">Quản trị</Link>
      </div>
    </div>
  </footer>;
}
