import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { ContactButton, CopyButton } from "@/components/contact-button";
import { ProductCard } from "@/components/product-card";
import { ProductGallery } from "@/components/product-gallery";
import { SectionHeading } from "@/components/section-heading";
import { StickyContact } from "@/components/sticky-contact";
import { publicApi } from "@/lib/api";
import { getStoreName } from "@/lib/brand";
import { formatPrice } from "@/lib/format";
import { allowedMessengerUrl } from "@/lib/messenger";

type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  try {
    const [product, siteName] = await Promise.all([publicApi.product((await params).slug), getStoreName()]);
    const url = `/san-pham/${product.slug}`;
    const description = product.description?.slice(0, 155);
    const image = (product.images.find(img => img.is_primary) ?? product.images[0])?.url;
    // openGraph is replaced, not merged, by child segments: repeat siteName here.
    return { title: product.name, description, alternates: { canonical: url }, openGraph: { type: "website", siteName, title: product.name, description, url, images: image ? [image] : [] } };
  } catch { return { title: "Không tìm thấy sản phẩm", robots: { index: false } }; }
}

const availability = {
  in_stock: { label: "Còn hàng", tone: "success" },
  out_of_stock: { label: "Tạm hết hàng", tone: "" },
  contact: { label: "Liên hệ để biết tình trạng", tone: "" },
} as const;

export default async function ProductDetailPage({ params }: Props) {
  const slug = (await params).slug; let product;
  try { product = await publicApi.product(slug); } catch { notFound(); }
  const [related, settings] = await Promise.all([
    publicApi.products(`category=${product.category?.slug ?? ""}&page_size=5`).catch(() => ({ items: [], page: 1, page_size: 5, total: 0, pages: 0 })),
    publicApi.settings().catch(() => null),
  ]);
  const messageUrl = settings?.messenger_url ?? settings?.facebook_url ?? "https://facebook.com";
  const stickyUrl = allowedMessengerUrl(settings?.messenger_url) ?? allowedMessengerUrl(settings?.facebook_url);
  const relatedItems = related.items.filter(p => p.id !== product.id).slice(0, 4);
  const specs = Object.entries(product.attributes).filter(([, value]) => value);
  const stock = availability[product.stock_status];
  const jsonLd = { "@context": "https://schema.org", "@type": "Product", name: product.name, sku: product.sku, image: product.images.map(i => i.url), description: product.description, offers: product.price ? { "@type": "Offer", priceCurrency: "VND", price: product.price, availability: product.stock_status === "in_stock" ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" } : undefined };

  return <div className={`shell pt-6 md:pt-8 ${stickyUrl ? "pb-32 md:pb-20" : "pb-20"}`}><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
    <nav aria-label="Đường dẫn" className="mb-6 text-sm text-ink-soft">
      <ol className="flex flex-wrap items-center gap-1">
        <li><Link href="/san-pham" className="hover:text-ink">Sản phẩm</Link></li>
        {product.category && <><li aria-hidden="true"><ChevronRight size={14} /></li><li><Link href={`/san-pham?category=${product.category.slug}`} className="hover:text-ink">{product.category.name}</Link></li></>}
      </ol>
    </nav>

    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-14">
      <ProductGallery images={product.images} name={product.name} />

      <section aria-labelledby="ten-san-pham" className="lg:sticky lg:top-24 lg:self-start">
        <h1 id="ten-san-pham" className="display text-[2rem] leading-tight md:text-[2.75rem]">{product.name}</h1>
        <p className="mt-2 text-sm text-ink-soft">Mã sản phẩm: <span className="font-medium text-ink">{product.sku}</span></p>

        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-line py-5">
          <p className="text-[1.75rem] font-semibold tabular-nums leading-none">{formatPrice(product.price)}</p>
          <p className={`badge ${stock.tone}`}><span className="dot" aria-hidden="true" />{stock.label}</p>
        </div>

        <div id="lien-he-chinh" className="mt-6 grid gap-3">
          <ContactButton productId={product.id} href={messageUrl} />
          <p className="text-sm text-ink-soft">Gửi mã sản phẩm qua Messenger để được báo giá, kiểm tra màu và phí giao hàng.</p>
          <div className="flex flex-wrap gap-2"><CopyButton value={product.sku} label="mã" /><CopyButton value={`${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/san-pham/${product.slug}`} label="đường dẫn" /></div>
        </div>

        {specs.length > 0 && <div className="mt-10">
          <h2 className="text-base font-semibold">Thông số</h2>
          <dl className="mt-3 border-t border-line text-[.9375rem]">{specs.map(([key, value]) => <div key={key} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 border-b border-line py-3"><dt className="text-ink-soft">{key}</dt><dd className="font-medium">{value}</dd></div>)}</dl>
        </div>}

        {product.description && <div className="mt-10">
          <h2 className="text-base font-semibold">Mô tả</h2>
          <p className="mt-3 max-w-prose whitespace-pre-line leading-7 text-[#3d3a36]">{product.description}</p>
        </div>}
      </section>
    </div>

    {relatedItems.length > 0 && <section className="mt-20 border-t border-line pt-14 md:mt-28">
      <SectionHeading title="Sản phẩm cùng loại" href={product.category ? `/san-pham?category=${product.category.slug}` : "/san-pham"} />
      <div className="grid grid-cols-1 min-[340px]:grid-cols-2 gap-x-4 gap-y-10 md:gap-x-6 lg:grid-cols-4">{relatedItems.map(p => <ProductCard key={p.id} product={p} />)}</div>
    </section>}
    {stickyUrl && <StickyContact productId={product.id} href={stickyUrl} price={formatPrice(product.price)} />}
  </div>;
}
