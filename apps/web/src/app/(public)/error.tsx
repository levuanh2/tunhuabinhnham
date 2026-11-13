"use client";

import Link from "next/link";
import { RotateCw } from "lucide-react";

// A public page whose data could not load (backend down, rate-limited, timed out). Rendered inside the
// public layout; the page is never edge-cached because apiFetch marked the render degraded.
export default function PublicError() {
  return <div className="shell py-16 md:py-24">
    <div role="alert" className="mx-auto max-w-xl rounded-xl border border-dashed border-line-strong px-6 py-14 text-center">
      <h1 className="display text-3xl md:text-4xl">Chưa tải được dữ liệu</h1>
      <p className="mx-auto mt-3 max-w-md text-ink-soft">Hệ thống đang bận hoặc tạm gián đoạn, không phải cửa hàng hết hàng. Bạn vui lòng thử lại sau ít phút.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={() => window.location.reload()} className="button min-h-12 px-6"><RotateCw size={18} aria-hidden="true" />Thử lại</button>
        <Link prefetch={false} href="/lien-he" className="button secondary min-h-12 px-6">Liên hệ cửa hàng</Link>
      </div>
    </div>
  </div>;
}
