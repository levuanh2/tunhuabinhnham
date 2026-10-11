"use client";

import Image from "next/image";
import { ChangeEvent, useState } from "react";
import { toast } from "sonner";
import { deleteAdminMedia, uploadAdminMedia, validateMediaFile } from "@/lib/admin-media";
import type { MediaAsset } from "@/types/api";

type Props = {
  label: string;
  bucket: "post-images" | "banners" | "branding";
  value: string | null;
  onChange: (url: string | null, upload?: MediaAsset) => void;
  onExistingRemoved?: (url: string) => void;
  allowIcon?: boolean;
  help?: string;
  onBusyChange?: (busy: boolean) => void;
};

export function AdminMediaUpload({ label, bucket, value, onChange, onExistingRemoved, allowIcon = false, help, onBusyChange }: Props) {
  const [upload, setUpload] = useState<MediaAsset | null>(null);
  const [busy, setBusy] = useState(false);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const invalid = validateMediaFile(file, allowIcon);
    if (invalid) { toast.error(invalid); return; }
    setBusy(true);
    onBusyChange?.(true);
    try {
      const next = await uploadAdminMedia(bucket, file);
      let previousDeleted = false;
      if (upload) {
        try { await deleteAdminMedia({ id: upload.id }); previousDeleted = true; }
        catch { /* It may already be referenced by a saved record; clean it after save. */ }
      }
      if (value && !previousDeleted) onExistingRemoved?.(value);
      setUpload(next);
      onChange(next.url, next);
      toast.success("Đã tải ảnh lên");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Không thể tải ảnh"); }
    finally { setBusy(false); onBusyChange?.(false); }
  }

  async function remove() {
    if (!value) return;
    setBusy(true);
    onBusyChange?.(true);
    try {
      let removed = false;
      if (upload) {
        try { await deleteAdminMedia({ id: upload.id }); removed = true; }
        catch { /* A saved reference must be removed before the object can be deleted. */ }
      }
      if (!removed) onExistingRemoved?.(value);
      setUpload(null);
      onChange(null);
    } finally { setBusy(false); onBusyChange?.(false); }
  }

  return <fieldset className="grid gap-3 rounded-md border border-slate-200 p-4">
    <legend className="px-1 font-bold">{label}</legend>
    {help && <p className="text-sm muted">{help}</p>}
    {value ? <div className="grid gap-3 sm:grid-cols-[180px_1fr] sm:items-start">
      <Image src={value} alt={`Xem trước ${label.toLowerCase()}`} width={360} height={240} unoptimized={allowIcon} className="max-h-44 w-full rounded-md border border-slate-200 object-contain" />
      <div className="flex flex-wrap gap-3">
        <label className="button secondary cursor-pointer">{busy ? "Đang xử lý…" : "Thay ảnh"}<input className="sr-only" type="file" accept={allowIcon ? "image/jpeg,image/png,image/webp,image/x-icon" : "image/jpeg,image/png,image/webp"} disabled={busy} onChange={choose} /></label>
        <button className="button secondary text-red-700" type="button" disabled={busy} onClick={remove}>Gỡ ảnh</button>
      </div>
    </div> : <label className="button secondary w-fit cursor-pointer">{busy ? "Đang tải…" : "Chọn ảnh"}<input className="sr-only" type="file" accept={allowIcon ? "image/jpeg,image/png,image/webp,image/x-icon" : "image/jpeg,image/png,image/webp"} disabled={busy} onChange={choose} /></label>}
  </fieldset>;
}
