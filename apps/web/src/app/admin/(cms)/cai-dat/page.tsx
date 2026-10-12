"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AdminMediaUpload } from "@/components/admin-media-upload";
import { AdminPageHeader } from "@/components/admin-shell";
import { adminFetch } from "@/lib/admin-api";
import { cleanupMediaUrls } from "@/lib/admin-media";
import type { SiteSettings } from "@/types/api";

export default function SettingsPage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["settings"], queryFn: () => adminFetch<SiteSettings>("/site-settings") });
  const [form, setForm] = useState<Partial<SiteSettings>>({});
  const [cleanup, setCleanup] = useState<Set<string>>(new Set());
  const [logoBusy, setLogoBusy] = useState(false);
  const [faviconBusy, setFaviconBusy] = useState(false);

  // Reset the form whenever a new settings object arrives (render-time adjustment, not an effect).
  const [loaded, setLoaded] = useState<SiteSettings>();
  if (query.data && query.data !== loaded) {
    setLoaded(query.data);
    setForm(query.data);
    setCleanup(new Set());
  }

  const save = useMutation({
    mutationFn: () => adminFetch<SiteSettings>("/site-settings", { method: "PATCH", body: JSON.stringify(form) }),
    onSuccess: async saved => {
      const failed = await cleanupMediaUrls(cleanup);
      setForm(saved);
      setCleanup(new Set(failed));
      client.setQueryData(["settings"], saved);
      toast.success("Đã lưu cài đặt");
      if (failed.length) toast.warning("Cài đặt đã lưu, nhưng media cũ chưa thể dọn dẹp");
    },
    onError: error => toast.error(error.message),
  });

  if (query.isPending) {
    return <><AdminPageHeader title="Cài đặt cửa hàng" /><p className="text-ink-soft">Đang tải cài đặt…</p></>;
  }
  if (query.isError) {
    return <><AdminPageHeader title="Cài đặt cửa hàng" /><div role="alert" className="alert">Không thể tải cài đặt. <button type="button" className="ml-2 font-semibold underline" onClick={() => void query.refetch()}>Thử lại</button></div></>;
  }

  return <>
    <AdminPageHeader title="Cài đặt cửa hàng" description="Tên, logo, liên hệ và SEO mặc định hiển thị trên website." />
    <form className="panel grid gap-6 p-4 sm:p-6" onSubmit={event => { event.preventDefault(); if (!logoBusy && !faviconBusy) save.mutate(); }}>
      <div className="grid gap-6 lg:grid-cols-2">
        <AdminMediaUpload label="Logo" bucket="branding" value={form.logo_url ?? null} onChange={url => setForm(current => ({ ...current, logo_url: url }))} onExistingRemoved={url => setCleanup(current => new Set(current).add(url))} onBusyChange={setLogoBusy} help="JPEG, PNG hoặc WebP; nền trong suốt được khuyến nghị." />
        <AdminMediaUpload label="Favicon" bucket="branding" value={form.favicon_url ?? null} onChange={url => setForm(current => ({ ...current, favicon_url: url }))} onExistingRemoved={url => setCleanup(current => new Set(current).add(url))} onBusyChange={setFaviconBusy} allowIcon help="ICO, PNG, JPEG hoặc WebP; ảnh vuông được khuyến nghị." />
      </div>
      <label className="label">Tên cửa hàng<span className="hint">Hiển thị ở đầu trang, chân trang và tiêu đề tab. Ví dụ: Tủ Nhựa Bình Nhâm</span><input required maxLength={200} className="field" value={form.store_name ?? ""} onChange={event => setForm({ ...form, store_name: event.target.value })} /></label>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="label">Facebook URL<input required className="field" type="url" value={form.facebook_url ?? ""} onChange={event => setForm({ ...form, facebook_url: event.target.value })} /></label>
        <label className="label">Messenger URL<input className="field" type="url" value={form.messenger_url ?? ""} onChange={event => setForm({ ...form, messenger_url: event.target.value || null })} /></label>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="label">Hotline<input className="field" value={form.hotline ?? ""} onChange={event => setForm({ ...form, hotline: event.target.value })} /></label>
        <label className="label">Địa chỉ<input className="field" value={form.address ?? ""} onChange={event => setForm({ ...form, address: event.target.value })} /></label>
      </div>
      <label className="label">Giới thiệu<textarea className="field min-h-32" value={form.about_text ?? ""} onChange={event => setForm({ ...form, about_text: event.target.value })} /></label>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="label">SEO title mặc định<input maxLength={260} className="field" value={form.default_seo_title ?? ""} onChange={event => setForm({ ...form, default_seo_title: event.target.value })} /></label>
        <label className="label">SEO description mặc định<textarea maxLength={320} className="field min-h-24" value={form.default_seo_description ?? ""} onChange={event => setForm({ ...form, default_seo_description: event.target.value })} /></label>
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm font-medium"><input type="checkbox" checked={form.contact_tracking_enabled ?? true} onChange={event => setForm({ ...form, contact_tracking_enabled: event.target.checked })} />Ghi nhận lượt nhấn liên hệ</label>
      <button className="button justify-self-start" disabled={save.isPending || logoBusy || faviconBusy}>{save.isPending ? "Đang lưu…" : logoBusy || faviconBusy ? "Đang tải ảnh…" : "Lưu thay đổi"}</button>
    </form>
  </>;
}
