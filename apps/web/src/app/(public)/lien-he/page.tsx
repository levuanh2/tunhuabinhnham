import type { Metadata } from "next";
import { MessageCircle } from "lucide-react";
import { publicApi } from "@/lib/api";
import { safeMessengerUrl } from "@/lib/messenger";

export const metadata: Metadata = { title: "Liên hệ" };

export default async function ContactPage() {
  const settings = await publicApi.settings().catch(() => null);
  const messenger = safeMessengerUrl(settings?.messenger_url ?? settings?.facebook_url);
  return <div className="section shell grid gap-12 lg:grid-cols-12">
    <div className="lg:col-span-6">
      <h1 className="display h-page">Liên hệ cửa hàng</h1>
      <p className="lede mt-4">Gửi mã sản phẩm qua Messenger để biết giá, tình trạng hàng và cách giao.</p>
      <a className="button mt-8 min-h-12 px-6" href={messenger} target="_blank" rel="noopener noreferrer"><MessageCircle size={18} aria-hidden="true" />Mở Messenger</a>
    </div>
    <dl className="self-start border-t border-line lg:col-span-5 lg:col-start-8">
      {settings?.hotline && <div className="grid gap-1 border-b border-line py-5"><dt className="text-sm text-ink-soft">Hotline</dt><dd className="text-lg font-medium"><a href={`tel:${settings.hotline.replace(/\s/g, "")}`} className="hover:text-primary">{settings.hotline}</a></dd></div>}
      {settings?.address && <div className="grid gap-1 border-b border-line py-5"><dt className="text-sm text-ink-soft">Địa chỉ</dt><dd className="text-lg font-medium">{settings.address}</dd></div>}
      {settings?.facebook_url && <div className="grid gap-1 border-b border-line py-5"><dt className="text-sm text-ink-soft">Fanpage</dt><dd className="text-lg font-medium"><a href={safeMessengerUrl(settings.facebook_url)} target="_blank" rel="noopener noreferrer" className="link">Mở trang Facebook</a></dd></div>}
    </dl>
  </div>;
}
