"use client";

import Image from "next/image";
import { ChangeEvent, useState } from "react";
import { toast } from "sonner";
import { uploadAdminMedia, validateMediaFile } from "@/lib/admin-media";
import type { MediaAsset } from "@/types/api";

type Props = {
  label: string;
  bucket: "post-images" | "banners" | "branding";
  value: string | null;
  onChange: (url: string | null, upload?: MediaAsset) => void;
  /** The replaced or removed image: delete it after the record is saved, never before (V1-BUG-01). */
  onExistingRemoved?: (url: string) => void;
  allowIcon?: boolean;
  help?: string;
  onBusyChange?: (busy: boolean) => void;
};

export function AdminMediaUpload({ label, bucket, value, onChange, onExistingRemoved, allowIcon = false, help, onBusyChange }: Props) {
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
      if (value) onExistingRemoved?.(value);
      onChange(next.url, next);
      toast.success("Đã tải ảnh lên");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Không thể tải ảnh"); }
    finally { setBusy(false); onBusyChange?.(false); }
  }

  function remove() {
    if (!value) return;
    onExistingRemoved?.(value);
    onChange(null);
  }

  return <fieldset className="grid gap-3 rounded-lg border border-line p-4">
    <legend className="px-1 text-sm font-semibold">{label}</legend>
    {help && <p className="hint">{help}</p>}
    {value ? <div className="grid gap-3 sm:grid-cols-[180px_1fr] sm:items-start">
      <Image src={value} alt={`Xem trước ${label.toLowerCase()}`} width={360} height={240} unoptimized={allowIcon} className="max-h-44 w-full rounded-lg border border-line bg-muted object-contain" />
      <div className="flex flex-wrap gap-3">
        <label className="button secondary sm cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary">{busy ? "Đang xử lý…" : "Thay ảnh"}<input className="sr-only" type="file" accept={allowIcon ? "image/jpeg,image/png,image/webp,image/x-icon" : "image/jpeg,image/png,image/webp"} disabled={busy} onChange={choose} /></label>
        <button className="button danger sm" type="button" disabled={busy} onClick={remove}>Gỡ ảnh</button>
      </div>
    </div> : <label className="button secondary sm w-fit cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary">{busy ? "Đang tải…" : "Chọn ảnh"}<input className="sr-only" type="file" accept={allowIcon ? "image/jpeg,image/png,image/webp,image/x-icon" : "image/jpeg,image/png,image/webp"} disabled={busy} onChange={choose} /></label>}
  </fieldset>;
}
