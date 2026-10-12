import type { Metadata } from "next";
import { FALLBACK_STORE_NAME } from "@/lib/brand";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, MessageCircle } from "lucide-react";
import { PostCard } from "@/components/post-card";
import { ProductCard } from "@/components/product-card";
import { SectionHeading } from "@/components/section-heading";
import { publicApi } from "@/lib/api";
import { safeMessengerUrl } from "@/lib/messenger";
import type { Product } from "@/types/api";

export const metadata: Metadata = { alternates: { canonical: "/" } };

const primaryImage = (product: Product) => product.images.find(item => item.is_primary) ?? product.images[0];

export default async function HomePage() {
  const [products, categories, posts, banners, settings] = await Promise.all([
    publicApi.products("page_size=12&sort=-published_at").catch(() => ({ items: [], page: 1, page_size: 12, total: 0, pages: 0 })),
    publicApi.categories().catch(() => []),
    publicApi.posts().catch(() => ({ items: [], page: 1, page_size: 6, total: 0, pages: 0 })),
    publicApi.banners().catch(() => []),
    publicApi.settings().catch(() => null),
  ]);
  const banner = banners[0];
  const featured = products.items.filter(p => p.is_featured).slice(0, 4);
  const arrivals = products.items.filter(p => !featured.includes(p)).slice(0, 8);
  const withImages = products.items.filter(p => primaryImage(p));
  const introSrc = banners[1]?.image_url ?? (withImages[1] ? primaryImage(withImages[1])!.url : null);
  const storeName = settings?.store_name ?? FALLBACK_STORE_NAME;
  const messenger = safeMessengerUrl(settings?.messenger_url ?? settings?.facebook_url);
  const secondaryCta = banner?.cta_url && banner.cta_label && banner.cta_url !== "/san-pham" ? { href: banner.cta_url, label: banner.cta_label } : null;

  return <>
    {/* Hero: the photograph is the subject; text sits beside it like a catalogue cover. */}
    <section className="shell grid items-center gap-8 pb-12 pt-8 md:pt-12 lg:grid-cols-12 lg:gap-12 lg:pb-20">
      <div className="lg:col-span-5">
        <h1 className="display h-hero">{banner?.title ?? "Nhà gọn gàng bắt đầu từ một chiếc tủ vừa ý"}</h1>
        <p className="lede mt-5">{banner?.subtitle ?? "Tủ quần áo, tủ ngăn kéo và kệ nhựa cho từng góc trong nhà. Xem mẫu, so kích thước rồi nhắn tin để được báo giá."}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link className="button min-h-12 px-6" href="/san-pham">Xem sản phẩm <ArrowRight size={18} aria-hidden="true" /></Link>
          {secondaryCta
            ? <Link className="button secondary min-h-12 px-6" href={secondaryCta.href}>{secondaryCta.label}</Link>
            : <a className="button secondary min-h-12 px-6" href={messenger} target="_blank" rel="noopener noreferrer"><MessageCircle size={18} aria-hidden="true" />Hỏi cửa hàng</a>}
        </div>
      </div>
      <div className="lg:col-span-7">
        {banner?.image_url
          ? <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-muted lg:aspect-[5/4]"><Image src={banner.image_url} alt={banner.title} fill priority sizes="(min-width: 1024px) 58vw, 100vw" className="object-cover" /></div>
          : withImages.length >= 3
            ? <div className="grid aspect-[4/3] grid-cols-[1.4fr_1fr] grid-rows-2 gap-3 lg:aspect-[5/4]">{withImages.slice(0, 3).map((p, i) => <Link key={p.id} href={`/san-pham/${p.slug}`} className={`relative overflow-hidden rounded-2xl bg-muted ${i === 0 ? "row-span-2" : ""}`}><Image src={primaryImage(p)!.url} alt={primaryImage(p)!.alt_text ?? p.name} fill priority={i === 0} sizes="(min-width: 1024px) 35vw, 60vw" className="object-cover" /></Link>)}</div>
            : <div className="grid aspect-[4/3] place-items-center rounded-2xl bg-muted p-8 text-center text-ink-soft lg:aspect-[5/4]"><p className="max-w-xs">Ảnh banner sẽ hiển thị tại đây sau khi được thêm trong trang quản trị.</p></div>}
      </div>
    </section>

    {categories.length > 0 && <section aria-labelledby="danh-muc" className="border-y border-line bg-surface py-10 md:py-14">
      <div className="shell">
        <h2 id="danh-muc" className="display text-2xl md:text-[1.75rem]">Mua theo nhu cầu</h2>
        <ul className="no-scrollbar -mx-4 mt-6 flex snap-x gap-3 overflow-x-auto px-4 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 lg:grid-cols-5">
          {categories.map(c => <li key={c.id} className="w-[64%] shrink-0 snap-start sm:w-[40%] md:w-auto">
            <Link href={`/san-pham?category=${c.slug}`} className="group flex h-full flex-col overflow-hidden rounded-xl border border-line bg-bg transition-colors hover:border-sand">
              {c.image_url && <span className="relative block aspect-[4/3] bg-muted"><Image src={c.image_url} alt="" fill sizes="(min-width: 1024px) 20vw, 60vw" className="object-cover" /></span>}
              <span className="grid gap-1 p-4">
                <span className="flex items-center justify-between gap-2 font-semibold">{c.name}<ArrowRight size={16} aria-hidden="true" className="shrink-0 text-sand transition-transform group-hover:translate-x-0.5 group-hover:text-primary" /></span>
                {c.description && <span className="line-clamp-2 text-sm text-ink-soft">{c.description}</span>}
              </span>
            </Link>
          </li>)}
        </ul>
      </div>
    </section>}

    {featured.length > 0 && <section className="section shell">
      <SectionHeading title="Sản phẩm nổi bật" description="Những mẫu cửa hàng đang giới thiệu." href="/san-pham" />
      <div className="grid grid-cols-1 min-[340px]:grid-cols-2 gap-x-4 gap-y-10 md:gap-x-6 lg:grid-cols-4">{featured.map(p => <ProductCard key={p.id} product={p} />)}</div>
    </section>}

    <section className={`shell ${featured.length ? "pb-16 md:pb-24" : "section"}`}>
      <SectionHeading title="Hàng mới về" description="Sản phẩm vừa được cập nhật lên website." href="/san-pham" />
      {arrivals.length
        ? <div className="grid grid-cols-1 min-[340px]:grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 md:gap-x-6 lg:grid-cols-4">{arrivals.map(p => <ProductCard key={p.id} product={p} />)}</div>
        : <div className="rounded-xl border border-dashed border-line-strong px-6 py-14 text-center"><p className="font-medium">Chưa có sản phẩm nào được xuất bản.</p><p className="mt-1 text-sm text-ink-soft">Sản phẩm sẽ hiện ở đây sau khi được xuất bản trong trang quản trị.</p></div>}
    </section>

    <section className="bg-muted">
      <div className="section shell grid items-center gap-10 md:grid-cols-2 md:gap-16">
        {introSrc && <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-bg"><Image src={introSrc} alt="" fill sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" /></div>}
        <div className={introSrc ? "" : "md:col-span-2 md:max-w-2xl"}>
          <h2 className="display h-section">Về {storeName}</h2>
          <p className="mt-5 whitespace-pre-line text-lg leading-8 text-ink-soft">{settings?.about_text || "Cửa hàng chuyên tủ nhựa và đồ lưu trữ cho gia đình: tủ quần áo, tủ ngăn kéo, tủ giày và kệ bếp."}</p>
          <Link href="/gioi-thieu" className="link mt-6 inline-flex items-center gap-1.5">Tìm hiểu thêm<ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
      </div>
    </section>

    {posts.items.length > 0 && <section className="section shell">
      <SectionHeading title="Mẹo hay cho nhà gọn" description="Hướng dẫn chọn tủ, sắp xếp và giữ đồ nhựa bền đẹp." href="/tin-tuc" linkLabel="Tất cả bài viết" />
      <div className="grid gap-x-6 gap-y-12 md:grid-cols-2 lg:grid-cols-3">{posts.items.slice(0, 3).map(p => <PostCard key={p.id} post={p} />)}</div>
    </section>}

    <section className={`shell pb-16 md:pb-24 ${posts.items.length ? "" : "pt-16 md:pt-24"}`}>
      <div className="grid gap-6 rounded-2xl bg-primary px-6 py-10 text-white md:grid-cols-[1fr_auto] md:items-center md:px-12 md:py-14">
        <div>
          <h2 className="display text-3xl md:text-4xl">Cần tư vấn kích thước hay màu sắc?</h2>
          <p className="mt-3 max-w-xl leading-7 text-primary-soft">Gửi mã sản phẩm hoặc ảnh góc nhà qua Messenger. Cửa hàng sẽ báo giá, tình trạng hàng và cách giao.</p>
        </div>
        <a href={messenger} target="_blank" rel="noopener noreferrer" className="button min-h-12 !bg-surface px-6 !text-primary hover:!bg-primary-soft"><MessageCircle size={18} aria-hidden="true" />Nhắn tin qua Messenger</a>
      </div>
    </section>
  </>;
}
