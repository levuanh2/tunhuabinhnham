import { FALLBACK_STORE_NAME } from "@/lib/brand";
import type { Metadata } from "next";
import Link from "next/link";
import { publicApi } from "@/lib/api";

export const metadata: Metadata = { title: "Giới thiệu", alternates: { canonical: "/gioi-thieu" } };

export default async function AboutPage() {
  const settings = await publicApi.settings().catch(() => null);
  const storeName = settings?.store_name ?? FALLBACK_STORE_NAME;
  return <div className="section shell grid gap-10 lg:grid-cols-12">
    <h1 className="display h-page lg:col-span-5">Về {storeName}</h1>
    <div className="max-w-2xl space-y-5 text-lg leading-8 text-ink-soft lg:col-span-7">
      {settings?.about_text && <p className="whitespace-pre-line text-ink">{settings.about_text}</p>}
      <p>{storeName} giới thiệu tủ nhựa, tủ quần áo, tủ ngăn kéo và đồ lưu trữ cho gia đình. Mỗi sản phẩm trên website có ảnh, mã và giá (nếu có) để bạn dễ so sánh.</p>
      <p>Website không nhận thanh toán trực tiếp. Hãy lưu mã sản phẩm rồi nhắn tin cho cửa hàng để được tư vấn kích thước, màu sắc và giao hàng.</p>
      <div className="flex flex-wrap gap-3 pt-3"><Link href="/san-pham" className="button">Xem sản phẩm</Link><Link href="/lien-he" className="button secondary">Liên hệ</Link></div>
    </div>
  </div>;
}
