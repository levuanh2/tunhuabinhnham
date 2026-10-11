"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: "right" | "left" | "bottom";
  /** Render the panel inline (not as a modal) from the md breakpoint up. */
  inlineFromMd?: boolean;
  className?: string;
  children: React.ReactNode;
};

/**
 * Native modal <dialog>: the browser provides Escape-to-close, focus containment, inert background
 * and focus return to the trigger. We add background scroll lock and backdrop-click close.
 */
// ponytail: a closed <dialog> forced visible with CSS doubles as the inline desktop panel, so form fields exist once.
const INLINE = "md:!static md:!block md:!m-0 md:!h-auto md:!max-h-none md:!w-auto md:!max-w-none md:!overflow-visible md:!rounded-none md:!bg-transparent md:!p-0 md:!shadow-none";

export function Sheet({ open, onClose, title, side = "right", inlineFromMd = false, className = "", children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (!open) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => { root.style.overflow = previous; };
  }, [open]);

  useEffect(() => {
    if (!inlineFromMd || !open) return;
    const query = window.matchMedia("(min-width: 768px)");
    const onChange = () => { if (query.matches) onClose(); };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [inlineFromMd, open, onClose]);

  const position = side === "bottom"
    ? "inset-x-0 bottom-0 top-auto mx-0 mb-0 max-h-[85dvh] w-full max-w-none rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
    : `${side === "right" ? "ml-auto mr-0" : "ml-0 mr-auto"} my-0 h-dvh max-h-none w-[min(88vw,360px)]`;

  return <dialog ref={ref} aria-label={title} onClose={onClose}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const r = event.currentTarget.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose();
    }}
    className={`sheet fixed overflow-y-auto overscroll-contain bg-bg p-0 text-ink shadow-xl backdrop:bg-ink/40 ${position} ${inlineFromMd ? INLINE : ""} ${className}`}>
    <div className={`sticky top-0 z-10 flex min-h-14 items-center justify-between gap-3 border-b border-line bg-bg px-4 pt-[env(safe-area-inset-top)] ${inlineFromMd ? "md:hidden" : ""}`}>
      <p className="text-base font-semibold">{title}</p>
      <button type="button" onClick={onClose} className="grid size-11 place-items-center rounded-full hover:bg-muted" aria-label="Đóng"><X size={20} aria-hidden="true" /></button>
    </div>
    {children}
  </dialog>;
}
