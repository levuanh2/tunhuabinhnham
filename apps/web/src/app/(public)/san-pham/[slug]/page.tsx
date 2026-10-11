import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ContactButton, CopyButton } from "@/components/contact-button";
import { ProductCard } from "@/components/product-card";
import { publicApi } from "@/lib/api";
import { formatPrice } from "@/lib/format";

type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> { try { const product = await publicApi.product((await params).slug); return { title: product.name, description: product.description?.slice(0, 155), alternates: { canonical: `/san-pham/${product.slug}` }, openGraph: { title: product.name, images: product.images[0]?.url ? [product.images[0].url] : [] } }; } catch { return { title: "Không tìm thấy sản phẩm" }; } }

export default async function ProductDetailPage({ params }: Props) {
  const slug = (await params).slug; let product;
  try { product = await publicApi.product(slug); } catch { notFound(); }
  const [related, settings] = await Promise.all([
    publicApi.products(`category=${product.category?.slug ?? ""}&page_size=4`).catch(() => ({ items: [], page: 1, page_size: 4, total: 0, pages: 0 })),
    publicApi.settings().catch(() => null),
  ]);
  const messageUrl = settings?.messenger_url ?? settings?.facebook_url ?? "https://facebook.com";
  const jsonLd = { "@context": "https://schema.org", "@type": "Product", name: product.name, sku: product.sku, image: product.images.map(i => i.url), description: product.description, offers: product.price ? { "@type": "Offer", priceCurrency: "VND", price: product.price, availability: product.stock_status === "in_stock" ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" } : undefined };
  return <div className="section shell"><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
    <div className="grid gap-10 lg:grid-cols-[1.15fr_.85fr]"><div className="grid grid-cols-2 gap-3">{product.images.length ? product.images.map((image, index) => <Image key={image.id} src={image.url} alt={image.alt_text ?? product.name} width={900} height={1125} priority={index === 0} className={`h-auto w-full rounded-md bg-[#e8edf6] object-cover ${index === 0 ? "col-span-2" : ""}`} />) : <div className="col-span-2 grid aspect-square place-items-center bg-[#e8edf6] muted">Chưa có ảnh</div>}</div>
      <section className="lg:sticky lg:top-28 lg:self-start"><p className="font-semibold text-[#1648d8]">{product.category?.name}</p><h1 className="display mt-3 text-5xl">{product.name}</h1><p className="mt-3 text-sm muted">Mã sản phẩm: {product.sku}</p><p className="mt-7 text-3xl font-bold">{formatPrice(product.price)}</p><p className="mt-3 font-medium">{product.stock_status === "in_stock" ? "Còn hàng" : product.stock_status === "out_of_stock" ? "Tạm hết hàng" : "Liên hệ để biết tình trạng"}</p><p className="mt-8 whitespace-pre-line leading-8 muted">{product.description}</p>
        <div className="mt-8 flex flex-wrap gap-3"><ContactButton productId={product.id} href={messageUrl} /><CopyButton value={product.sku} label="mã" /><CopyButton value={`${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/san-pham/${product.slug}`} label="đường dẫn" /></div>
        {Object.keys(product.attributes).length > 0 && <dl className="mt-10 border-t border-slate-300">{Object.entries(product.attributes).map(([key, value]) => <div key={key} className="grid grid-cols-2 gap-4 border-b border-slate-300 py-3"><dt className="font-semibold">{key}</dt><dd>{value}</dd></div>)}</dl>}
      </section></div>
    {related.items.filter(p => p.id !== product.id).length > 0 && <section className="pt-24"><h2 className="display mb-9 text-4xl">Có thể bạn cũng thích</h2><div className="grid grid-cols-2 gap-4 md:grid-cols-4">{related.items.filter(p => p.id !== product.id).slice(0,4).map(p => <ProductCard key={p.id} product={p} />)}</div></section>}
  </div>;
}
