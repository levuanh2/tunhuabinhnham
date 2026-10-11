"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AdminPageHeader, QueryError } from "@/components/admin-shell";
import { adminFetch } from "@/lib/admin-api";
import type { Category } from "@/types/api";

const toSlug = (value: string) => value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export default function CategoriesPage() {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const query = useQuery({ queryKey: ["categories"], queryFn: () => adminFetch<Category[]>("/categories") });
  const create = useMutation({
    mutationFn: () => adminFetch("/categories", { method: "POST", body: JSON.stringify({ name, slug, is_visible: true, sort_order: 0 }) }),
    onSuccess: async () => { setName(""); setSlug(""); await client.invalidateQueries({ queryKey: ["categories"] }); toast.success("Đã tạo danh mục"); },
    onError: e => toast.error(e.message),
  });
  async function remove(item: Category) {
    if (!confirm(`Ẩn và xóa danh mục “${item.name}”?`)) return;
    try { await adminFetch(`/categories/${item.id}`, { method: "DELETE" }); await client.invalidateQueries({ queryKey: ["categories"] }); toast.success("Đã xóa danh mục"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Không thể xóa danh mục"); }
  }

  return <>
    <AdminPageHeader title="Danh mục" description="Nhóm sản phẩm hiển thị trên trang Sản phẩm và trang chủ." />
    <form className="panel grid gap-4 p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={e => { e.preventDefault(); create.mutate(); }}>
      <label className="label">Tên<input required className="field" value={name} onChange={e => { setName(e.target.value); if (!slug) setSlug(toSlug(e.target.value)); }} /></label>
      <label className="label">Slug<input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" title="Chỉ gồm chữ thường không dấu, số và dấu gạch ngang" className="field" value={slug} onChange={e => setSlug(e.target.value)} /></label>
      <button className="button" disabled={create.isPending}>{create.isPending ? "Đang thêm…" : "Thêm"}</button>
    </form>
    <div className="mt-6">
      {query.isPending ? <p className="text-ink-soft">Đang tải danh mục…</p>
        : query.isError ? <QueryError label="danh mục" onRetry={() => void query.refetch()} />
        : query.data.length === 0 ? <div className="panel px-6 py-12 text-center text-ink-soft">Chưa có danh mục. Thêm danh mục đầu tiên ở form phía trên.</div>
        : <ul className="panel divide-y divide-line">{query.data.map(item => <li key={item.id} className="flex items-center justify-between gap-3 py-2 pl-4 pr-2">
            <div className="min-w-0"><p className="font-medium">{item.name}</p><p className="truncate text-sm text-ink-soft">/san-pham?category={item.slug}</p></div>
            <button type="button" className="button ghost sm shrink-0 !text-danger hover:!bg-danger-soft" onClick={() => void remove(item)} aria-label={`Xóa danh mục ${item.name}`}>Xóa</button>
          </li>)}</ul>}
    </div>
  </>;
}
