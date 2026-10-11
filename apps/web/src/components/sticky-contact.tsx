"use client";

import { useEffect, useState } from "react";
import { ContactButton } from "./contact-button";

/** Mobile-only bottom CTA, shown once the inline CTA (#lien-he-chinh) has scrolled out of view. */
export function StickyContact({ productId, href, price }: { productId: string; href: string; price: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const target = document.getElementById("lien-he-chinh");
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(!entry.isIntersecting && entry.boundingClientRect.top < 0));
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  return <div aria-hidden={!visible} inert={!visible}
    className={`fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 px-4 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md transition-transform duration-200 md:hidden ${visible ? "translate-y-0" : "translate-y-full"}`}>
    <div className="flex items-center gap-3">
      <p className="shrink-0 text-base font-semibold tabular-nums">{price}</p>
      <div className="min-w-0 flex-1"><ContactButton productId={productId} href={href} /></div>
    </div>
  </div>;
}
