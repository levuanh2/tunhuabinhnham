"use client";

import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Sheet } from "./sheet";

/** Price + sort fields: a bottom sheet on phones, inline on md+. Must be rendered inside the filter <form>. */
export function ProductFilters({ minPrice, maxPrice, sort, activeCount }: { minPrice?: string; maxPrice?: string; sort?: string; activeCount: number }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="button secondary shrink-0 md:hidden">
      <SlidersHorizontal size={17} aria-hidden="true" />Lọc{activeCount > 0 && <span className="grid size-5 place-items-center rounded-full bg-primary text-xs text-white" aria-label={`${activeCount} bộ lọc đang dùng`}>{activeCount}</span>}
    </button>
    <Sheet open={open} onClose={() => setOpen(false)} title="Lọc và sắp xếp" side="bottom" inlineFromMd>
      <div className="grid gap-4 p-4 md:grid-cols-[repeat(3,minmax(0,1fr))_auto] md:items-end md:gap-3 md:p-0">
        <div className="label"><label htmlFor="sap-xep">Sắp xếp</label><select id="sap-xep" className="field" name="sort" defaultValue={sort ?? "-published_at"}><option value="-published_at">Mới nhất</option><option value="price">Giá thấp đến cao</option><option value="-price">Giá cao đến thấp</option></select></div>
        <div className="grid grid-cols-2 gap-3 md:contents">
          <label className="label">Giá từ<input className="field" name="min_price" type="number" min="0" step="10000" inputMode="numeric" defaultValue={minPrice ?? ""} placeholder="0 ₫" /></label>
          <label className="label">Đến<input className="field" name="max_price" type="number" min="0" step="10000" inputMode="numeric" defaultValue={maxPrice ?? ""} placeholder="Không giới hạn" /></label>
        </div>
        <button className="button min-h-12 md:min-h-11">Áp dụng</button>
      </div>
    </Sheet>
  </>;
}
