"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, FileText, Image, LayoutDashboard, LogOut, Settings, Tags } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const links = [
  { href: "/admin", label: "Tổng quan", icon: LayoutDashboard },
  { href: "/admin/san-pham", label: "Sản phẩm", icon: Boxes },
  { href: "/admin/danh-muc", label: "Danh mục", icon: Tags },
  { href: "/admin/bai-viet", label: "Bài viết", icon: FileText },
  { href: "/admin/banner", label: "Banner", icon: Image },
  { href: "/admin/cai-dat", label: "Cài đặt", icon: Settings },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  async function signOut() {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) return;
    await createClient().auth.signOut({ scope: "local" });
    window.location.replace("/admin/login");
  }

  return (
    <div className="min-h-screen bg-slate-100 md:grid md:grid-cols-[240px_1fr]">
      <aside className="bg-[#10213f] p-5 text-white md:min-h-screen">
        <Link href="/admin" className="display text-2xl">Tủ CMS</Link>
        <nav className="mt-8 grid grid-cols-3 gap-2 md:grid-cols-1">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded px-3 py-2.5 text-sm font-medium ${pathname === href ? "bg-[#d6f23d] text-[#10213f]" : "text-slate-300 hover:bg-white/10"}`}
            >
              <Icon size={18}/>{label}
            </Link>
          ))}
        </nav>
        <button className="mt-8 flex items-center gap-2 text-sm text-slate-300" onClick={() => void signOut()}>
          <LogOut size={18}/>Đăng xuất
        </button>
      </aside>
      <div>
        <header className="flex h-18 items-center border-b border-slate-200 bg-white px-5 md:px-8">
          <p className="font-bold">Quản trị nội dung</p>
        </header>
        <main className="p-5 md:p-8">{children}</main>
      </div>
    </div>
  );
}
