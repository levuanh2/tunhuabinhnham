import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/date";
import type { Post } from "@/types/api";

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  let post;
  try { post = await apiFetch<Post>(`/posts/${(await params).slug}`); } catch { notFound(); }
  return <article className="pb-20 pt-8 md:pt-12">
    <header className="shell max-w-3xl">
      <Link href="/tin-tuc" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-soft hover:text-ink"><ArrowLeft size={16} aria-hidden="true" />Tin tức</Link>
      <h1 className="display h-page mt-6">{post.title}</h1>
      {post.excerpt && <p className="lede mt-4">{post.excerpt}</p>}
      {post.published_at && <time dateTime={post.published_at} className="mt-5 block text-sm text-ink-soft">{formatDate(post.published_at)}</time>}
    </header>
    {post.cover_image_url && <div className="shell mt-10 max-w-5xl"><div className="relative aspect-[16/9] overflow-hidden rounded-2xl bg-muted"><Image src={post.cover_image_url} alt="" fill priority sizes="(min-width: 1024px) 64rem, 100vw" className="object-cover" /></div></div>}
    <div className="shell mt-10 max-w-[44rem] md:mt-14"><div className="prose" dangerouslySetInnerHTML={{ __html: post.content_html }} /></div>
  </article>;
}
