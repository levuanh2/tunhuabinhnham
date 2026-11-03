import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function SectionHeading({ title, description, href, linkLabel = "Xem tất cả" }: { title: string; description?: string; href?: string; linkLabel?: string }) {
  return <div className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 md:mb-10">
    <div className="max-w-2xl"><h2 className="display h-section">{title}</h2>{description && <p className="mt-2 text-ink-soft">{description}</p>}</div>
    {href && <Link prefetch={false} href={href} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary-hover">{linkLabel}<ArrowRight size={16} aria-hidden="true" /></Link>}
  </div>;
}
