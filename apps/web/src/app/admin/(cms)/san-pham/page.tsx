"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { ChevronRight, Plus, Search } from "lucide-react";
import { AdminPageHeader, QueryError } from "@/components/admin-shell";
import { adminFetch } from "@/lib/admin-api";
import { formatPrice } from "@/lib/format";
import type { Page, Product } from "@/types/api";

const statusFilters = [
  { value: "all", label: "Tất cả trạng thái" },
  { value: "published", label: "Đã xuất bản" },
  { value: "draft", label: "Bản nháp" },
  { value: "hidden", label: "Đang ẩn" },
] as const;
type StatusFilter = (typeof statusFilters)[number]["value"];

function Status({ product }: { product: Product }) {
  return <span className="flex flex-wrap gap-1.5">
    <span className={`badge ${product.publish_status === "published" ? "success" : ""}`}><span className="dot" aria-hidden="true" />{product.publish_status === "published" ? "Đã xuất bản" : "Bản nháp"}</span>
    {!product.is_visible && <span className="badge">Đang ẩn</span>}
  </span>;
}

export default function AdminProductsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const term = useDeferredValue(search.trim());
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-products", term],
    queryFn: () => adminFetch<Page<Product>>(term ? `/products?search=${encodeURIComponent(term)}` : "/products"),
    placeholderData: keepPreviousData,
  });
  // ponytail: status filters the loaded page client-side; pass it to the API if the backend adds a status param.
  const items = (data?.items ?? []).filter(p => status === "all" || (status === "hidden" ? !p.is_visible : p.publish_status === status));
  const addButton = <Link href="/admin/san-pham/moi" className="button"><Plus size={17} aria-hidden="true" />Thêm sản phẩm</Link>;

  return <>
    <AdminPageHeader title="Sản phẩm" description="Tạo, xuất bản hoặc ẩn sản phẩm." action={addButton} />
    {error ? <QueryError label="sản phẩm" onRetry={() => void refetch()} />
      : !isLoading && !term && data?.items.length === 0
        ? <div className="panel px-6 py-14 text-center"><p className="font-medium">Chưa có sản phẩm nào.</p><p className="mt-1 text-sm text-ink-soft">Thêm sản phẩm đầu tiên để hiển thị trên website.</p><div className="mt-5">{addButton}</div></div>
        : <>
          <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
            <label className="relative block"><span className="sr-only">Tìm theo tên hoặc SKU</span>
              <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-soft" />
              <input className="field pl-10" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm theo tên hoặc SKU" />
            </label>
            <label><span className="sr-only">Lọc trạng thái</span>
              <select className="field" value={status} onChange={e => setStatus(e.target.value as StatusFilter)}>{statusFilters.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}</select>
            </label>
          </div>
          {isLoading ? <p className="panel px-5 py-8 text-center text-ink-soft">Đang tải sản phẩm…</p>
            : items.length === 0 ? <p className="panel px-5 py-8 text-center text-ink-soft">Không có sản phẩm khớp bộ lọc.</p>
            : <>
              <ul className="panel divide-y divide-line md:hidden">
                {items.map(p => {
                  const image = p.images.find(i => i.is_primary) ?? p.images[0];
                  return <li key={p.id}><Link href={`/admin/san-pham/${p.id}`} className="flex items-center gap-3 p-3 active:bg-muted">
                    <span className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-muted">{image && <Image src={image.url} alt="" fill sizes="56px" className="object-cover" />}</span>
                    <span className="grid min-w-0 flex-1 gap-1"><span className="truncate font-medium">{p.name}</span><span className="text-xs text-ink-soft">{p.sku}, {formatPrice(p.price)}</span><Status product={p} /></span>
                    <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-ink-soft" />
                  </Link></li>;
                })}
              </ul>
              <div className="panel hidden overflow-x-auto md:block">
                <table className="table">
                  <thead><tr><th scope="col">Sản phẩm</th><th scope="col">SKU</th><th scope="col">Giá</th><th scope="col">Trạng thái</th><th scope="col"><span className="sr-only">Thao tác</span></th></tr></thead>
                  <tbody>{items.map(p => {
                    const image = p.images.find(i => i.is_primary) ?? p.images[0];
                    return <tr key={p.id}>
                      <td><div className="flex items-center gap-3">
                        <span className="relative size-10 shrink-0 overflow-hidden rounded-md bg-muted">{image && <Image src={image.url} alt="" fill sizes="40px" className="object-cover" />}</span>
                        <Link href={`/admin/san-pham/${p.id}`} className="font-medium hover:text-primary">{p.name}</Link>
                      </div></td>
                      <td className="text-ink-soft">{p.sku}</td>
                      <td className="tabular-nums">{formatPrice(p.price)}</td>
                      <td><Status product={p} /></td>
                      <td className="text-right"><Link className="button ghost sm" href={`/admin/san-pham/${p.id}`} aria-label={`Sửa ${p.name}`}>Sửa</Link></td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
            </>}
        </>}
  </>;
}
