"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, MessageCircle, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Sheet } from "./sheet";

type Item = { href: string; label: string };
const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

export function NavLinks({ items }: { items: Item[] }) {
  const pathname = usePathname();
  return <ul className="flex items-center gap-1">{items.map(item => <li key={item.href}>
    <Link href={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined} className="rounded-full px-3.5 py-2 text-[.9375rem] font-medium text-ink-soft transition-colors hover:text-ink aria-[current=page]:text-ink aria-[current=page]:underline aria-[current=page]:decoration-sand aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-8">{item.label}</Link>
  </li>)}</ul>;
}

export function MobileNav({ items }: { items: Item[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearch = useRef(false);
  // Close on navigation: adjust state during render instead of in an effect (react.dev/learn/you-might-not-need-an-effect).
  const [shownPath, setShownPath] = useState(pathname);
  if (shownPath !== pathname) { setShownPath(pathname); setOpen(false); }
  useEffect(() => { if (open && focusSearch.current) { searchRef.current?.focus(); focusSearch.current = false; } }, [open]);

  return <div className="flex items-center lg:hidden">
    <button type="button" className="grid size-11 place-items-center rounded-full text-ink hover:bg-muted" aria-label="Tìm sản phẩm" onClick={() => { focusSearch.current = true; setOpen(true); }}>
      <Search size={21} aria-hidden="true" />
    </button>
    <button type="button" className="grid size-11 place-items-center rounded-full text-ink hover:bg-muted" aria-haspopup="dialog" aria-expanded={open} aria-label="Mở menu" onClick={() => setOpen(true)}>
      <Menu size={22} aria-hidden="true" />
    </button>
    <Sheet open={open} onClose={() => setOpen(false)} title="Menu">
      <form action="/san-pham" role="search" className="px-4 pt-4">
        <label className="relative block"><span className="sr-only">Tìm sản phẩm</span>
          <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-soft" />
          <input ref={searchRef} className="field pl-10" type="search" name="search" placeholder="Tìm tủ, kệ, hộp đựng…" enterKeyHint="search" />
        </label>
      </form>
      <nav aria-label="Menu di động" className="px-4 pt-2">
        <ul>{items.map(item => <li key={item.href}>
          <Link href={item.href} onClick={() => setOpen(false)} aria-current={isActive(pathname, item.href) ? "page" : undefined} className="flex min-h-13 items-center border-b border-line py-3 text-lg font-medium aria-[current=page]:text-primary">{item.label}</Link>
        </li>)}</ul>
      </nav>
      <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><Link href="/lien-he" onClick={() => setOpen(false)} className="button w-full min-h-12"><MessageCircle size={18} aria-hidden="true" />Nhắn tin cho cửa hàng</Link></div>
    </Sheet>
  </div>;
}
