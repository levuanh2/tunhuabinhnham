import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { getStoreName } from "@/lib/brand";
import { formatDate } from "@/lib/date";
import type { Post } from "@/types/api";

type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  try {
    const [post, siteName] = await Promise.all([apiFetch<Post>(`/posts/${(await params).slug}`), getStoreName()]);
    const url = `/tin-tuc/${post.slug}`;
    const description = post.excerpt?.slice(0, 155) ?? undefined;
    return { title: post.title, description, alternates: { canonical: url }, openGraph: { type: "article", siteName, title: post.title, description, url, publishedTime: post.published_at ?? undefined, images: post.cover_image_url ? [post.cover_image_url] : [] } };
  } catch { return { title: "Không tìm thấy bài viết", robots: { index: false } }; }
}

export default async function PostPage({ params }: Props) {
  let post;
  try { post = await apiFetch<Post>(`/posts/${(await params).slug}`); } catch { notFound(); }
  return <article className="pb-20 pt-8 md:pt-12">
    <header className="shell max-w-3xl">
      <Link prefetch={false} href="/tin-tuc" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-soft hover:text-ink"><ArrowLeft size={16} aria-hidden="true" />Tin tức</Link>
      <h1 className="display h-page mt-6">{post.title}</h1>
      {post.excerpt && <p className="lede mt-4">{post.excerpt}</p>}
      {post.published_at && <time dateTime={post.published_at} className="mt-5 block text-sm text-ink-soft">{formatDate(post.published_at)}</time>}
    </header>
    {post.cover_image_url && <div className="shell mt-10 max-w-5xl"><div className="relative aspect-[16/9] overflow-hidden rounded-2xl bg-muted"><Image src={post.cover_image_url} alt="" fill priority sizes="(min-width: 1024px) 64rem, 100vw" className="object-cover" /></div></div>}
    <div className="shell mt-10 max-w-[44rem] md:mt-14"><div className="prose" dangerouslySetInnerHTML={{ __html: post.content_html }} /></div>
  </article>;
}
