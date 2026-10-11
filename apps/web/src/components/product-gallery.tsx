"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import type { ProductImage } from "@/types/api";

/** Native scroll-snap carousel: swipe on touch, thumbnails/dots jump to an image. */
export function ProductGallery({ images, name }: { images: ProductImage[]; name: string }) {
  const ordered = [...images].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order);
  const [index, setIndex] = useState(0);
  const track = useRef<HTMLDivElement>(null);

  if (!ordered.length) return <div className="grid aspect-[4/5] place-items-center rounded-2xl bg-muted text-ink-soft">Chưa có ảnh sản phẩm</div>;

  const go = (i: number) => {
    const el = track.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: el.clientWidth * i, behavior: reduce ? "auto" : "smooth" });
    setIndex(i);
  };

  return <div className="grid gap-3 md:grid-cols-[72px_minmax(0,1fr)] md:gap-4" role="region" aria-roledescription="thư viện ảnh" aria-label={`Ảnh ${name}`}>
    <div className="relative md:order-2">
      <div ref={track} onScroll={event => { const el = event.currentTarget; const i = Math.round(el.scrollLeft / el.clientWidth); if (i !== index) setIndex(i); }}
        className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-2xl bg-muted" tabIndex={ordered.length > 1 ? 0 : undefined} aria-label={ordered.length > 1 ? "Vuốt hoặc dùng phím mũi tên để xem ảnh" : undefined}>
        {ordered.map((image, i) => <div key={image.id} className="relative aspect-[4/5] w-full shrink-0 snap-center" aria-hidden={i !== index}>
          <Image src={image.url} alt={image.alt_text ?? name} fill priority={i === 0} loading={i === 0 ? undefined : "lazy"} sizes="(min-width: 1024px) 50vw, 100vw" className="object-cover" />
        </div>)}
      </div>
      {ordered.length > 1 && <p className="absolute bottom-3 right-3 rounded-full bg-surface/90 px-2.5 py-0.5 text-xs font-semibold tabular-nums md:hidden" aria-live="polite">{index + 1}/{ordered.length}</p>}
    </div>
    {ordered.length > 1 && <ul className="no-scrollbar flex gap-2 overflow-x-auto md:order-1 md:flex-col md:overflow-visible" aria-label="Chọn ảnh">
      {ordered.map((image, i) => <li key={image.id} className="shrink-0">
        <button type="button" onClick={() => go(i)} aria-label={`Xem ảnh ${i + 1} trên ${ordered.length}`} aria-pressed={i === index}
          className="relative block aspect-[4/5] w-14 overflow-hidden rounded-lg bg-muted opacity-70 ring-offset-2 ring-offset-bg aria-pressed:opacity-100 aria-pressed:ring-2 aria-pressed:ring-primary md:w-[72px]">
          <Image src={image.url} alt="" fill sizes="72px" className="object-cover" />
        </button>
      </li>)}
    </ul>}
  </div>;
}
