"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { useState } from "react";
import { toast } from "sonner";
import { AdminMediaUpload } from "@/components/admin-media-upload";
import { adminFetch } from "@/lib/admin-api";
import { cleanupMediaUrls } from "@/lib/admin-media";
import type { Banner } from "@/types/api";

type FormState = Omit<Banner, "id"> & { id?: string };
const emptyForm = (): FormState => ({ title: "", subtitle: "", image_url: "", cta_label: "", cta_url: "", is_active: true, sort_order: 0 });

export default function BannerPage() {
  const client = useQueryClient();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [cleanup, setCleanup] = useState<Set<string>>(new Set());
  const query = useQuery({ queryKey: ["banners-admin"], queryFn: () => adminFetch<Banner[]>("/banners") });
  function reset() { setForm({ ...emptyForm(), sort_order: query.data?.length ?? 0 }); setCleanup(new Set()); }
  function edit(banner: Banner) { setForm({ ...banner }); setCleanup(new Set()); window.scrollTo({ top: 0, behavior: "smooth" }); }
  const save = useMutation({
    mutationFn: () => adminFetch<Banner>(form.id ? `/banners/${form.id}` : "/banners", { method: form.id ? "PATCH" : "POST", body: JSON.stringify({ title: form.title, subtitle: form.subtitle || null, image_url: form.image_url, cta_label: form.cta_label || null, cta_url: form.cta_url || null, is_active: form.is_active, sort_order: form.sort_order }) }),
    onSuccess: async saved => { const failed = await cleanupMediaUrls(cleanup); setForm({ ...saved }); setCleanup(new Set(failed)); await client.invalidateQueries({ queryKey: ["banners-admin"] }); toast.success(form.id ? "Đã cập nhật banner" : "Đã thêm banner"); if (failed.length) toast.warning("Banner đã lưu, nhưng ảnh cũ chưa thể dọn dẹp"); },
    onError: error => toast.error(error.message),
  });
  const remove = useMutation({ mutationFn: (id: string) => adminFetch<void>(`/banners/${id}`, { method: "DELETE" }), onSuccess: async () => { reset(); await client.invalidateQueries({ queryKey: ["banners-admin"] }); toast.success("Đã ẩn banner"); }, onError: error => toast.error(error.message) });

  return <>
    <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-bold">Banner trang chủ</h1><p className="mt-2 muted">Upload trực tiếp qua backend đến bucket banners.</p></div>{form.id && <button type="button" className="button secondary" onClick={reset}>Tạo banner mới</button>}</div>
    <form className="mt-8 grid gap-5 rounded-md bg-white p-4 sm:p-6 lg:grid-cols-2" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
      <div className="grid content-start gap-5"><label className="label">Tiêu đề<input required maxLength={240} className="field" value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} /></label><label className="label">Phụ đề<textarea className="field min-h-24" value={form.subtitle ?? ""} onChange={event => setForm({ ...form, subtitle: event.target.value })} /></label><div className="grid gap-5 sm:grid-cols-2"><label className="label">Nhãn CTA<input className="field" maxLength={80} value={form.cta_label ?? ""} onChange={event => setForm({ ...form, cta_label: event.target.value })} /></label><label className="label">URL CTA<input className="field" type="url" value={form.cta_url ?? ""} onChange={event => setForm({ ...form, cta_url: event.target.value })} /></label></div><div className="grid gap-5 sm:grid-cols-2"><label className="label">Thứ tự<input required min={0} className="field" type="number" value={form.sort_order} onChange={event => setForm({ ...form, sort_order: Number(event.target.value) })} /></label><label className="flex items-center gap-3 self-end pb-3"><input type="checkbox" checked={form.is_active} onChange={event => setForm({ ...form, is_active: event.target.checked })} />Đang hoạt động</label></div></div>
      <AdminMediaUpload key={form.id ?? "new"} label="Ảnh banner" bucket="banners" value={form.image_url || null} onChange={url => setForm(current => ({ ...current, image_url: url ?? "" }))} onExistingRemoved={url => setCleanup(current => new Set(current).add(url))} help="JPEG, PNG hoặc WebP; tối đa 8 MiB." />
      <div className="flex flex-wrap gap-3 lg:col-span-2"><button className="button" disabled={save.isPending || !form.image_url}>{save.isPending ? "Đang lưu…" : form.id ? "Lưu banner" : "Thêm banner"}</button>{form.id && <button type="button" className="button secondary text-red-700" disabled={remove.isPending} onClick={() => { if (confirm("Ẩn banner này?")) remove.mutate(form.id!); }}>Ẩn banner</button>}</div>
    </form>
    <section className="mt-8"><h2 className="text-xl font-bold">Danh sách banner</h2>{query.isPending ? <p className="mt-4">Đang tải banner…</p> : query.isError ? <div className="mt-4 rounded-md bg-red-50 p-4 text-red-800">Không thể tải banner. <button className="underline" onClick={() => void query.refetch()}>Thử lại</button></div> : query.data.length === 0 ? <p className="mt-4 rounded-md bg-white p-5 muted">Chưa có banner.</p> : <div className="mt-4 grid gap-4 md:grid-cols-2">{query.data.map(banner => <button type="button" onClick={() => edit(banner)} className="overflow-hidden rounded-md bg-white text-left" key={banner.id}><Image src={banner.image_url} alt={banner.title} width={720} height={300} className="aspect-12/5 w-full object-cover" /><span className="flex items-center justify-between gap-3 p-4"><span className="font-semibold">{banner.title}</span><span className="text-xs muted">Thứ tự {banner.sort_order} · {banner.is_active ? "Hiện" : "Ẩn"}</span></span></button>)}</div>}</section>
  </>;
}
