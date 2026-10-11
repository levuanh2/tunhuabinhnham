import Link from "next/link";
import Image from "next/image";
import { ArrowRight, MessageCircle } from "lucide-react";
import { ProductCard } from "@/components/product-card";
import { publicApi } from "@/lib/api";

export default async function HomePage() {
  const [products, categories, posts, banners] = await Promise.all([
    publicApi.products("page_size=8&sort=-published_at").catch(() => ({ items: [], page: 1, page_size: 8, total: 0, pages: 0 })),
    publicApi.categories().catch(() => []), publicApi.posts().catch(() => ({ items: [], page: 1, page_size: 6, total: 0, pages: 0 })), publicApi.banners().catch(() => []),
  ]);
  const banner = banners[0];
  return <>
    <section className="overflow-hidden bg-[#1648d8] text-white">
      <div className="shell grid min-h-[620px] items-center gap-10 py-16 lg:grid-cols-[1.05fr_.95fr]">
        <div><h1 className="display max-w-3xl text-6xl leading-[.95] sm:text-7xl lg:text-8xl">{banner?.title ?? "Xem tận mắt. Chọn thật kỹ."}</h1><p className="mt-7 max-w-xl text-lg leading-8 text-blue-100">{banner?.subtitle ?? "Một nơi gọn gàng để khám phá sản phẩm, đọc đủ thông tin và hỏi cửa hàng ngay khi cần."}</p><div className="mt-9 flex flex-wrap gap-3"><Link className="button !bg-[#d6f23d] !text-[#10213f]" href={banner?.cta_url ?? "/san-pham"}>Xem sản phẩm <ArrowRight size={18} /></Link><Link className="button border-white/50 !bg-transparent" href="/lien-he"><MessageCircle size={18} /> Trò chuyện</Link></div></div>
        {banner?.image_url ? <div className="relative mx-auto aspect-square w-full max-w-[520px] overflow-hidden rounded-[18%_42%_16%_38%]"><Image src={banner.image_url} alt={banner.title} fill priority className="object-cover" /></div> : <div aria-hidden="true" className="relative mx-auto aspect-square w-full max-w-[520px]"><div className="absolute inset-[8%] rotate-6 rounded-[18%_42%_16%_38%] bg-[#d6f23d]"/><div className="absolute inset-[20%_5%_3%_22%] rounded-[42%_14%_38%_16%] bg-white/95 shadow-2xl"/><p className="display absolute bottom-[23%] left-[31%] rotate-[-5deg] text-5xl text-[#10213f]">chọn lọc</p></div>}
      </div>
    </section>
    <section className="border-b border-slate-200 bg-white py-8"><div className="shell flex gap-3 overflow-x-auto pb-2">{categories.length ? categories.map(c => <Link key={c.id} href={`/san-pham?category=${c.slug}`} className="shrink-0 rounded-full border border-slate-300 px-5 py-2 font-medium hover:border-[#1648d8]">{c.name}</Link>) : <p className="muted">Danh mục sẽ xuất hiện sau khi được xuất bản từ CMS.</p>}</div></section>
    <section className="section shell"><div className="mb-10 flex items-end justify-between"><div><h2 className="display text-5xl">Sản phẩm mới</h2><p className="mt-3 muted">Những lựa chọn vừa lên kệ.</p></div><Link href="/san-pham" className="hidden font-bold text-[#1648d8] sm:block">Xem tất cả</Link></div>{products.items.length ? <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4">{products.items.map(p => <ProductCard key={p.id} product={p} />)}</div> : <div className="border-y border-slate-200 py-16 text-center muted">Chưa có sản phẩm công khai. Hãy xuất bản sản phẩm đầu tiên trong CMS.</div>}</section>
    <section className="bg-[#e8edf6]"><div className="section shell grid gap-12 lg:grid-cols-[.8fr_1.2fr]"><h2 className="display text-5xl">Chuyện phía sau món đồ</h2><div className="grid gap-7 sm:grid-cols-2">{posts.items.length ? posts.items.slice(0,4).map(p => <article key={p.id} className="border-t border-[#10213f] pt-4"><p className="text-sm muted">{p.published_at ? new Date(p.published_at).toLocaleDateString("vi-VN") : ""}</p><h3 className="mt-3 text-xl font-bold"><Link href={`/tin-tuc/${p.slug}`}>{p.title}</Link></h3><p className="mt-2 muted">{p.excerpt}</p></article>) : <p className="muted">Bài viết mới sẽ được cập nhật tại đây.</p>}</div></div></section>
    <section className="section shell grid gap-10 lg:grid-cols-2"><h2 className="display max-w-lg text-5xl">Tư vấn trực tiếp, không qua giỏ hàng.</h2><div><p className="max-w-xl text-lg leading-8 muted">Lưu mã sản phẩm bạn thích rồi nhắn cho cửa hàng. Chúng tôi sẽ xác nhận tình trạng, giá và cách nhận phù hợp.</p><Link href="/lien-he" className="button mt-7">Liên hệ Fanpage</Link></div></section>
  </>;
}
