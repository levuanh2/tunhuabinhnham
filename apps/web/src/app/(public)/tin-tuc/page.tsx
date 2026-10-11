import type { Metadata } from "next";
import { PostCard } from "@/components/post-card";
import { publicApi } from "@/lib/api";

export const metadata: Metadata = { title: "Tin tức", description: "Mẹo chọn tủ nhựa, sắp xếp nhà cửa và thông tin mới từ cửa hàng." };

export default async function PostsPage() {
  const posts = await publicApi.posts().catch(() => ({ items: [], page: 1, page_size: 20, total: 0, pages: 0 }));
  const [lead, ...rest] = posts.items;
  return <div className="shell pb-20 pt-10 md:pt-14">
    <header className="max-w-2xl">
      <h1 className="display h-page">Tin tức và mẹo hay</h1>
      <p className="lede mt-3">Cách chọn tủ theo diện tích, sắp xếp đồ đạc và giữ đồ nhựa bền đẹp.</p>
    </header>
    {lead
      ? <>
          <div className="mt-10 border-t border-line pt-10 md:mt-14"><PostCard post={lead} large /></div>
          {rest.length > 0 && <div className="mt-14 grid gap-x-6 gap-y-12 border-t border-line pt-12 md:grid-cols-2 lg:grid-cols-3">{rest.map(p => <PostCard key={p.id} post={p} />)}</div>}
        </>
      : <div className="mt-10 rounded-xl border border-dashed border-line-strong px-6 py-16 text-center"><p className="font-medium">Chưa có bài viết nào.</p><p className="mt-1 text-sm text-ink-soft">Bài viết mới sẽ hiện ở đây sau khi được xuất bản.</p></div>}
  </div>;
}
