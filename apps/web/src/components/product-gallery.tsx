"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight, ImageOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ProductImage } from "@/types/api";

/**
 * Native scroll-snap carousel (swipe on touch), thumbnails below and a native <dialog> lightbox.
 * object-contain keeps the whole cabinet visible: no cropped doors or feet, any aspect ratio.
 */
// ponytail: object-contain, not object-scale-down. With srcset the browser derives the intrinsic size from the
// requested width, so an original smaller than that variant would render shrunk on retina screens.
export function ProductGallery({ images, name }: { images: ProductImage[]; name: string }) {
  const ordered = [...images].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order);
  const [index, setIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const track = useRef<HTMLDivElement>(null);
  // Slide a programmatic scroll is heading to: intermediate scroll positions must not overwrite the selection.
  const target = useRef<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (zoomed && !el.open) el.showModal();
    if (!zoomed && el.open) el.close();
    if (!zoomed) return;
    const root = document.documentElement, previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => { root.style.overflow = previous; };
  }, [zoomed]);

  if (!ordered.length) return <div className="grid aspect-[4/5] place-items-center rounded-2xl bg-muted text-ink-soft">Chưa có ảnh sản phẩm</div>;

  const many = ordered.length > 1;
  const go = (i: number, smooth = true) => {
    const next = (i + ordered.length) % ordered.length;
    const el = track.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.current = el && el.scrollLeft !== el.clientWidth * next ? next : null;
    el?.scrollTo({ left: el.clientWidth * next, behavior: smooth && !reduce ? "smooth" : "auto" });
    setIndex(next);
  };
  const arrows = (event: React.KeyboardEvent, smooth: boolean) => {
    if (!many || (event.key !== "ArrowRight" && event.key !== "ArrowLeft")) return;
    event.preventDefault();
    go(index + (event.key === "ArrowRight" ? 1 : -1), smooth);
  };
  const markBroken = (id: string) => setBroken(current => new Set(current).add(id));
  const current = ordered[index];
  const alt = (image: ProductImage) => image.alt_text || name;
  const fallback = <span className="grid size-full place-items-center text-sm text-ink-soft"><span className="grid justify-items-center gap-2"><ImageOff size={28} aria-hidden="true" />Không tải được ảnh</span></span>;

  return <div className="grid min-w-0 content-start gap-3" role="region" aria-roledescription="thư viện ảnh" aria-label={`Ảnh ${name}`}>
    <div className="relative">
      <div ref={track} onScroll={event => {
          const el = event.currentTarget; const i = Math.round(el.scrollLeft / el.clientWidth);
          if (target.current !== null) { if (Math.abs(el.scrollLeft - target.current * el.clientWidth) < 2) target.current = null; return; }
          if (i !== index) setIndex(i);
        }}
        onPointerDown={() => { target.current = null; }} onWheel={() => { target.current = null; }} // a swipe or wheel takes over
        onKeyDown={event => arrows(event, true)}
        className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-2xl bg-muted" tabIndex={many ? 0 : undefined} aria-label={many ? "Vuốt hoặc dùng phím mũi tên để xem ảnh" : undefined}>
        {ordered.map((image, i) => <div key={image.id} data-slide={i} className="relative aspect-[4/5] w-full shrink-0 snap-center" aria-hidden={i !== index}>
          {broken.has(image.id) ? fallback
            : <button type="button" tabIndex={i === index ? 0 : -1} onClick={() => setZoomed(true)} className="relative block size-full cursor-zoom-in" aria-label={`Phóng to ảnh ${i + 1}${many ? ` trên ${ordered.length}` : ""}`}>
                <Image src={image.url} alt={alt(image)} fill priority={i === 0} loading={i === 0 ? undefined : "lazy"} sizes="(min-width: 1280px) 640px, (min-width: 1024px) 50vw, 100vw" className="object-contain p-3 md:p-5" onError={() => markBroken(image.id)} />
              </button>}
        </div>)}
      </div>
      {many && <p className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-surface/90 px-2.5 py-0.5 text-xs font-semibold tabular-nums" aria-live="polite">{index + 1}/{ordered.length}</p>}
    </div>

    {many && <ul className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 py-1" aria-label="Chọn ảnh">
      {ordered.map((image, i) => <li key={image.id} className="shrink-0">
        <button type="button" onClick={() => go(i)} aria-label={`Xem ảnh ${i + 1} trên ${ordered.length}`} aria-pressed={i === index}
          className="relative grid aspect-[4/5] w-16 place-items-center overflow-hidden rounded-lg bg-muted opacity-70 ring-offset-2 ring-offset-bg transition-opacity hover:opacity-100 aria-pressed:opacity-100 aria-pressed:ring-2 aria-pressed:ring-primary md:w-20">
          {broken.has(image.id) ? <ImageOff size={18} aria-hidden="true" className="text-ink-soft" />
            : <Image src={image.url} alt="" fill sizes="80px" className="object-cover" onError={() => markBroken(image.id)} />}
        </button>
      </li>)}
    </ul>}

    <dialog ref={dialog} aria-label={`Ảnh phóng to: ${name}`} onKeyDown={event => arrows(event, false)}
      onClose={() => {
        setZoomed(false);
        // The dialog restores focus to the button that opened it, which may now be a hidden slide: use the shown one.
        requestAnimationFrame(() => track.current?.querySelector<HTMLElement>(`[data-slide="${index}"] button`)?.focus());
      }}
      className="m-0 h-dvh max-h-none w-full max-w-none bg-ink/95 p-0 text-white backdrop:bg-ink/60">
      {zoomed && <div className="grid size-full grid-rows-[auto_minmax(0,1fr)] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-between gap-3 px-4 py-2">
          <p className="text-sm tabular-nums text-white/80" aria-live="polite">{many ? `${index + 1}/${ordered.length}` : ""}</p>
          <button type="button" onClick={() => setZoomed(false)} className="grid size-11 place-items-center rounded-full hover:bg-white/10" aria-label="Đóng ảnh phóng to" autoFocus><X size={22} aria-hidden="true" /></button>
        </div>
        <div className="relative mx-auto size-full max-w-6xl" onClick={event => { if (event.target === event.currentTarget) setZoomed(false); }}>
          {/* fill images are absolutely positioned (padding is ignored), so the margin comes from this inset box */}
          <div className="absolute inset-x-2 bottom-4 top-0 md:inset-x-16">
            {broken.has(current.id) ? fallback
              : <Image key={current.id} src={current.url} alt={alt(current)} fill sizes="100vw" className="object-contain" onError={() => markBroken(current.id)} />}
          </div>
          {many && <>
            <button type="button" onClick={() => go(index - 1, false)} className="absolute left-2 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 hover:bg-white/20 md:left-3" aria-label="Ảnh trước"><ChevronLeft size={24} aria-hidden="true" /></button>
            <button type="button" onClick={() => go(index + 1, false)} className="absolute right-2 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 hover:bg-white/20 md:right-3" aria-label="Ảnh sau"><ChevronRight size={24} aria-hidden="true" /></button>
          </>}
        </div>
      </div>}
    </dialog>
  </div>;
}
