import Image from "next/image";
import Link from "next/link";
import { formatDate } from "@/lib/date";
import type { Post } from "@/types/api";

export function PostCard({ post, large = false }: { post: Post; large?: boolean }) {
  return <article className={`group relative grid gap-4 ${large ? "md:grid-cols-[1.25fr_1fr] md:items-center md:gap-10" : ""}`}>
    <div className="relative aspect-[3/2] overflow-hidden rounded-xl bg-muted">
      {post.cover_image_url && <Image src={post.cover_image_url} alt="" fill sizes={large ? "(min-width: 768px) 55vw, 100vw" : "(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"} className="object-cover transition-transform duration-500 group-hover:scale-[1.02]" />}
    </div>
    <div>
      {post.published_at && <time dateTime={post.published_at} className="text-sm text-ink-soft">{formatDate(post.published_at)}</time>}
      <h3 className={`display mt-1.5 ${large ? "text-3xl md:text-4xl" : "text-[1.375rem]"}`}>
        <Link prefetch={false} href={`/tin-tuc/${post.slug}`} className="after:absolute after:inset-0 group-hover:text-primary">{post.title}</Link>
      </h3>
      {post.excerpt && <p className={`mt-2.5 leading-7 text-ink-soft ${large ? "text-lg" : "line-clamp-3"}`}>{post.excerpt}</p>}
    </div>
  </article>;
}
