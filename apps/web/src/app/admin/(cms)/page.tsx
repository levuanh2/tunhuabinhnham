"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { AdminPageHeader, QueryError } from "@/components/admin-shell";
import { adminFetch } from "@/lib/admin-api";

const cards = [
  { key: "products", label: "Sản phẩm", href: "/admin/san-pham" },
  { key: "visible_products", label: "Đang hiển thị", href: "/admin/san-pham" },
  { key: "categories", label: "Danh mục", href: "/admin/danh-muc" },
  { key: "posts", label: "Bài viết", href: "/admin/bai-viet" },
  { key: "contact_clicks", label: "Lượt nhấn liên hệ" },
];

export default function DashboardPage() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["dashboard"], queryFn: () => adminFetch<Record<string, number>>("/dashboard/stats") });
  return <>
    <AdminPageHeader title="Tổng quan" description="Số liệu nội dung hiện tại." action={<Link href="/admin/san-pham/moi" className="button"><Plus size={17} aria-hidden="true" />Thêm sản phẩm</Link>} />
    {error && <div className="mb-5"><QueryError label="số liệu" onRetry={() => void refetch()} /></div>}
    <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-line [gap:1px] lg:grid-cols-5">
      {cards.map(card => {
        const body = <><dt className="text-sm text-ink-soft">{card.label}</dt><dd className="mt-2 text-3xl font-semibold tabular-nums" aria-busy={isLoading}>{isLoading ? <span className="inline-block h-8 w-12 animate-pulse rounded bg-muted" /> : data?.[card.key] ?? 0}</dd></>;
        return <div key={card.key} className="bg-surface">{card.href ? <Link href={card.href} className="block p-5 hover:bg-[#fcfaf7]">{body}</Link> : <div className="p-5">{body}</div>}</div>;
      })}
    </dl>
  </>;
}
