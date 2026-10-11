import type { Metadata } from "next";
import Link from "next/link";
import { ProductCard } from "@/components/product-card";
import { publicApi } from "@/lib/api";

export const metadata: Metadata = { title: "Sản phẩm", description: "Khám phá danh mục sản phẩm đang được trưng bày." };

type Params = Promise<Record<string, string | string[] | undefined>>;
export default async function ProductsPage({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const key of ["search", "category", "min_price", "max_price", "sort", "page"]) { const value = params[key]; if (typeof value === "string" && value) query.set(key, value); }
  const [result, categories] = await Promise.all([publicApi.products(query.toString()).catch(() => ({ items: [], page: 1, page_size: 20, total: 0, pages: 0 })), publicApi.categories().catch(() => [])]);
  return <div className="section shell"><header className="max-w-3xl"><h1 className="display text-6xl">Mọi sản phẩm</h1><p className="mt-4 text-lg muted">Tìm theo tên, khoảng giá hoặc danh mục. Chọn một sản phẩm để xem ảnh và thông số đầy đủ.</p></header>
    <form className="my-10 grid gap-3 border-y border-slate-200 py-5 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]">
      <input className="field" name="search" defaultValue={typeof params.search === "string" ? params.search : ""} placeholder="Tìm tên sản phẩm" aria-label="Tìm tên sản phẩm" />
      <select className="field" name="category" defaultValue={typeof params.category === "string" ? params.category : ""} aria-label="Danh mục"><option value="">Mọi danh mục</option>{categories.map(c => <option key={c.id} value={c.slug}>{c.name}</option>)}</select>
      <input className="field" name="min_price" type="number" min="0" placeholder="Giá từ" aria-label="Giá từ" />
      <select className="field" name="sort" defaultValue={typeof params.sort === "string" ? params.sort : "-published_at"} aria-label="Sắp xếp"><option value="-published_at">Mới nhất</option><option value="price">Giá thấp trước</option><option value="-price">Giá cao trước</option></select>
      <button className="button">Áp dụng</button>
    </form>
    <p className="mb-6 text-sm muted">{result.total} sản phẩm</p>
    {result.items.length ? <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4">{result.items.map(p => <ProductCard key={p.id} product={p} />)}</div> : <div className="py-24 text-center"><h2 className="text-2xl font-bold">Không tìm thấy sản phẩm</h2><p className="mt-2 muted">Thử bỏ bớt bộ lọc hoặc tìm bằng từ khóa khác.</p></div>}
    {result.pages > 1 && <nav className="mt-14 flex justify-center gap-2" aria-label="Phân trang">{Array.from({ length: result.pages }, (_, i) => i + 1).map(page => <Link key={page} className={`grid size-11 place-items-center rounded border ${page === result.page ? "border-[#1648d8] bg-[#1648d8] text-white" : "border-slate-300"}`} href={{ query: { ...params, page } }}>{page}</Link>)}</nav>}
  </div>;
}
