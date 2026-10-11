import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { publicApi } from "@/lib/api";
export const metadata: Metadata = { title: "Tin tức" };
export default async function PostsPage() { const posts = await publicApi.posts().catch(() => ({ items: [], page: 1, page_size: 20, total: 0, pages: 0 })); return <div className="section shell"><h1 className="display text-6xl">Tin tức & câu chuyện</h1><div className="mt-12 grid gap-x-8 gap-y-14 md:grid-cols-2 lg:grid-cols-3">{posts.items.map(p => <article key={p.id}>{p.cover_image_url && <Image src={p.cover_image_url} alt="" width={800} height={500} className="aspect-[8/5] w-full rounded-md object-cover" />}<p className="mt-4 text-sm muted">{p.published_at ? new Date(p.published_at).toLocaleDateString("vi-VN") : ""}</p><h2 className="mt-2 text-2xl font-bold"><Link href={`/tin-tuc/${p.slug}`}>{p.title}</Link></h2><p className="mt-3 muted">{p.excerpt}</p></article>)}</div></div>; }
