import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { ProductCard } from "@/components/product-card";
import { ProductFilters } from "@/components/product-filters";
import { publicApi } from "@/lib/api";

export const metadata: Metadata = { title: "Sản phẩm", description: "Tủ nhựa, tủ quần áo, tủ ngăn kéo và kệ lưu trữ. Lọc theo loại tủ, giá và tìm theo tên.", alternates: { canonical: "/san-pham" } };

const FILTER_KEYS = ["search", "category", "min_price", "max_price", "sort", "page"] as const;
type Params = Promise<Record<string, string | string[] | undefined>>;

export default async function ProductsPage({ searchParams }: { searchParams: Params }) {
  const raw = await searchParams;
  const params: Record<string, string> = {};
  for (const key of FILTER_KEYS) { const value = raw[key]; if (typeof value === "string" && value) params[key] = value; }
  const [result, categories] = await Promise.all([
    publicApi.products(new URLSearchParams(params).toString()).catch(() => ({ items: [], page: 1, page_size: 20, total: 0, pages: 0 })),
    publicApi.categories().catch(() => []),
  ]);
  const href = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams({ ...params, ...patch } as Record<string, string>);
    for (const [key, value] of [...next.entries()]) if (!value || value === "undefined") next.delete(key);
    const query = next.toString();
    return query ? `/san-pham?${query}` : "/san-pham";
  };
  const active = categories.find(c => c.slug === params.category);
  // A hidden or deleted category is not offered as a filter, so its link shows nothing rather than a mislabelled list.
  const unknownCategory = Boolean(params.category && categories.length && !active);
  const items = unknownCategory ? [] : result.items;
  const total = unknownCategory ? 0 : result.total;
  const pages = unknownCategory ? 0 : result.pages;
  const filtered = Boolean(params.search || params.min_price || params.max_price || params.category);

  return <div className="shell pb-20 pt-10 md:pt-14">
    <header className="max-w-2xl">
      <h1 className="display h-page">{active?.name ?? "Tất cả sản phẩm"}</h1>
      <p className="lede mt-3">{active?.description ?? "Tủ quần áo, tủ ngăn kéo, tủ giày và kệ nhựa. Chọn một sản phẩm để xem ảnh, kích thước và giá."}</p>
    </header>

    {categories.length > 0 && <nav aria-label="Loại sản phẩm" className="mt-8 border-b border-line">
      <ul className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:px-0">
        {[{ id: "all", name: "Tất cả sản phẩm", slug: undefined as string | undefined }, ...categories].map(c => {
          const current = (c.slug ?? undefined) === params.category;
          return <li key={c.id} className="shrink-0"><Link href={href({ category: c.slug, page: undefined })} aria-current={current ? "page" : undefined} className="-mb-px block min-h-11 border-b-2 border-transparent px-3 py-3 text-[.9375rem] font-medium text-ink-soft hover:text-ink aria-[current=page]:border-primary aria-[current=page]:text-ink">{c.name}</Link></li>;
        })}
      </ul>
    </nav>}

    <form className="mt-6 flex gap-2 md:grid md:gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-end" role="search" aria-label="Lọc sản phẩm">
      {params.category && <input type="hidden" name="category" value={params.category} />}
      <label className="label min-w-0 flex-1"><span className="sr-only md:not-sr-only">Tìm theo tên</span>
        <span className="relative"><Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-soft" /><input id="tim-kiem" className="field pl-10" type="search" name="search" enterKeyHint="search" defaultValue={params.search ?? ""} placeholder="Tìm tủ, kệ, hộp đựng…" /></span>
      </label>
      <ProductFilters minPrice={params.min_price} maxPrice={params.max_price} sort={params.sort} activeCount={[params.min_price, params.max_price, params.sort && params.sort !== "-published_at"].filter(Boolean).length} />
    </form>

    <div className="mb-6 mt-8 flex flex-wrap items-center justify-between gap-3 text-sm text-ink-soft">
      <p aria-live="polite">{total} sản phẩm{params.search ? ` cho “${params.search}”` : ""}</p>
      {filtered && <Link href="/san-pham" className="link">Xoá bộ lọc</Link>}
    </div>

    {items.length
      ? <div className="grid grid-cols-1 min-[340px]:grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 md:gap-x-6 lg:grid-cols-4">{items.map((p, i) => <ProductCard key={p.id} product={p} priority={i < 2} />)}</div>
      : <div className="rounded-xl border border-dashed border-line-strong px-6 py-16 text-center">
          <h2 className="display text-2xl">{unknownCategory ? "Loại sản phẩm này hiện không còn hiển thị" : active && !params.search && !params.min_price && !params.max_price ? `Chưa có sản phẩm nào trong “${active.name}”` : "Không có sản phẩm phù hợp"}</h2>
          <p className="mx-auto mt-2 max-w-md text-ink-soft">{active && !params.search && !params.min_price && !params.max_price ? "Cửa hàng đang cập nhật thêm mẫu cho loại này. Bạn có thể xem các loại tủ khác." : "Thử từ khoá ngắn hơn, bỏ khoảng giá hoặc xem tất cả loại tủ."}</p>
          <Link href="/san-pham" className="button secondary mt-6">Xem tất cả sản phẩm</Link>
        </div>}

    {pages > 1 && <nav className="mt-14 flex flex-wrap justify-center gap-2" aria-label="Phân trang">
      {Array.from({ length: pages }, (_, i) => i + 1).map(page => <Link key={page} href={href({ page: String(page) })} aria-current={page === result.page ? "page" : undefined} aria-label={`Trang ${page}`} className="grid size-11 place-items-center rounded-full border border-line-strong text-sm font-medium hover:border-primary aria-[current=page]:border-primary aria-[current=page]:bg-primary aria-[current=page]:text-white">{page}</Link>)}
    </nav>}
  </div>;
}
