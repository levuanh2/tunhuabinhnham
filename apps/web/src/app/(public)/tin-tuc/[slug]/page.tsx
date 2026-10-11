import { notFound } from "next/navigation";
import { apiFetch } from "@/lib/api";
import type { Post } from "@/types/api";
export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) { let post; try { post = await apiFetch<Post>(`/posts/${(await params).slug}`); } catch { notFound(); } return <article className="section shell max-w-3xl"><p className="muted">{post.published_at ? new Date(post.published_at).toLocaleDateString("vi-VN") : ""}</p><h1 className="display mt-4 text-6xl leading-tight">{post.title}</h1><div className="prose prose-slate mt-10 max-w-none leading-8" dangerouslySetInnerHTML={{ __html: post.content_html }} /></article>; }
