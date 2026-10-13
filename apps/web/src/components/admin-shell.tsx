"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Boxes, ExternalLink, FileText, Image, LayoutDashboard, LogOut, Menu, Settings, Tags } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Sheet } from "./sheet";

const links = [
  { href: "/admin", label: "Tổng quan", icon: LayoutDashboard },
  { href: "/admin/san-pham", label: "Sản phẩm", icon: Boxes },
  { href: "/admin/danh-muc", label: "Loại sản phẩm", icon: Tags },
  { href: "/admin/bai-viet", label: "Bài viết", icon: FileText },
  { href: "/admin/banner", label: "Banner", icon: Image },
  { href: "/admin/cai-dat", label: "Cài đặt", icon: Settings },
];

const isActive = (pathname: string, href: string) => href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

export function AdminShell({ children, storeName }: { children: React.ReactNode; storeName: string }) {
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shownPath, setShownPath] = useState(pathname);
  if (shownPath !== pathname) { setShownPath(pathname); setMenuOpen(false); }

  async function signOut() {
    setSigningOut(true);
    const response = await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    if (!response?.ok) { setSigningOut(false); toast.error("Không thể đăng xuất. Hãy thử lại."); return; }
    await createClient().auth.signOut({ scope: "local" });
    window.location.replace("/admin/login");
  }

  const item = "flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-ink-soft transition-colors hover:bg-muted hover:text-ink md:min-h-10";
  return (
    <div className="min-h-dvh bg-bg md:grid md:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="sticky top-0 z-30 border-b border-line bg-surface pt-[env(safe-area-inset-top)] md:flex md:h-dvh md:flex-col md:border-b-0 md:border-r md:pt-0">
        <div className="flex h-14 items-center justify-between gap-3 px-4 md:h-16 md:px-5">
          <Link href="/admin" className="grid min-w-0 leading-tight"><span className="display truncate text-lg">{storeName}</span><span className="text-xs text-ink-soft">Quản trị nội dung</span></Link>
          <button type="button" className="-mr-2 grid size-11 place-items-center rounded-full hover:bg-muted md:hidden" aria-haspopup="dialog" aria-expanded={menuOpen} aria-label="Mở menu quản trị" onClick={() => setMenuOpen(true)}><Menu size={22} aria-hidden="true" /></button>
        </div>
        <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu quản trị" side="left" inlineFromMd className="md:min-h-0 md:flex-1">
          <div className="flex min-h-[calc(100%-3.5rem)] flex-col md:h-full md:min-h-0">
            <nav aria-label="Quản trị" className="flex-1 overflow-y-auto p-3 md:pt-2">
              <ul className="grid gap-1">
                {links.map(({ href, label, icon: Icon }) => (
                  <li key={href}>
                    <Link href={href} onClick={() => setMenuOpen(false)} aria-current={isActive(pathname, href) ? "page" : undefined}
                      className={`${item} aria-[current=page]:bg-primary-soft aria-[current=page]:text-primary`}>
                      <Icon size={17} aria-hidden="true" />{label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="grid gap-1 border-t border-line p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] md:pb-3">
              <a href="/" target="_blank" rel="noopener noreferrer" className={item}><ExternalLink size={17} aria-hidden="true" />Xem website</a>
              <button type="button" className={`${item} text-left disabled:opacity-60`} onClick={() => void signOut()} disabled={signingOut}>
                <LogOut size={17} aria-hidden="true" />{signingOut ? "Đang đăng xuất…" : "Đăng xuất"}
              </button>
            </div>
          </div>
        </Sheet>
      </aside>
      <main className="mx-auto w-full max-w-[1200px] px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5 md:px-8 md:py-8">{children}</main>
    </div>
  );
}

export function AdminPageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return <div className="mb-5 flex flex-wrap items-end justify-between gap-3 md:mb-6 md:gap-4">
    <div className="min-w-0"><h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>{description && <p className="mt-1 text-sm text-ink-soft">{description}</p>}</div>
    {action}
  </div>;
}

export function QueryError({ label, onRetry }: { label: string; onRetry: () => void }) {
  return <div role="alert" className="alert flex flex-wrap items-center justify-between gap-3">Không thể tải {label}.<button type="button" className="button danger sm" onClick={onRetry}>Thử lại</button></div>;
}
