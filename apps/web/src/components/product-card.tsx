import Image from "next/image";
import Link from "next/link";
import { formatPrice } from "@/lib/format";
import type { Product } from "@/types/api";

export function ProductCard({ product }: { product: Product }) {
  const image = product.images.find((item) => item.is_primary) ?? product.images[0];
  return <article className="group min-w-0">
    <Link href={`/san-pham/${product.slug}`} className="block overflow-hidden rounded-md bg-[#e8edf6] aspect-[4/5]">
      {image ? <Image src={image.url} alt={image.alt_text ?? product.name} width={720} height={900} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" /> : <div className="grid h-full place-items-center text-sm text-slate-500">Chưa có ảnh</div>}
    </Link>
    <div className="mt-4 flex items-start justify-between gap-3"><div><h3 className="font-semibold"><Link href={`/san-pham/${product.slug}`}>{product.name}</Link></h3><p className="mt-1 text-sm text-slate-500">{product.sku}</p></div><p className="shrink-0 font-bold text-[#1648d8]">{formatPrice(product.price)}</p></div>
  </article>;
}
