import Image from "next/image";
import Link from "next/link";
import { formatPrice } from "@/lib/format";
import type { Product } from "@/types/api";

export function ProductCard({ product, priority = false }: { product: Product; priority?: boolean }) {
  const image = product.images.find((item) => item.is_primary) ?? product.images[0];
  return <article className="group relative min-w-0">
    <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-muted">
      {image
        ? <Image src={image.url} alt={image.alt_text ?? product.name} fill priority={priority} sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw" className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.025]" />
        : <div className="grid h-full place-items-center text-sm text-ink-soft">Chưa có ảnh</div>}
      {product.stock_status === "out_of_stock" && <span className="badge absolute left-3 top-3 bg-surface/95">Tạm hết hàng</span>}
    </div>
    <div className="mt-3.5 grid gap-1">
      <h3 className="line-clamp-2 text-[.9375rem] font-medium leading-snug sm:text-base">
        <Link href={`/san-pham/${product.slug}`} className="after:absolute after:inset-0 after:rounded-xl group-hover:text-primary">{product.name}</Link>
      </h3>
      <p className="text-base font-semibold tabular-nums text-ink sm:text-[1.0625rem]">{formatPrice(product.price)}</p>
      <p className="truncate text-xs text-ink-soft">Mã {product.sku}</p>
    </div>
  </article>;
}
