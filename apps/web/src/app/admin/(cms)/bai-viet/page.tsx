"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { ChangeEvent, useState } from "react";
import { toast } from "sonner";
import { adminFetch } from "@/lib/admin-api";
import { cleanupMediaUrls, deleteAdminMedia, uploadAdminMedia, validateMediaFile } from "@/lib/admin-media";
import type { MediaAsset, Post, PostImage } from "@/types/api";

type FormState = {
  id?: string; title: string; slug: string; excerpt: string; content_html: string;
  publish_status: "draft" | "published"; cover_image_url: string | null;
  seo_title: string; seo_description: string; images: PostImage[];
};
const emptyForm = (): FormState => ({ title: "", slug: "", excerpt: "", content_html: "", publish_status: "draft", cover_image_url: null, seo_title: "", seo_description: "", images: [] });

function fromPost(post: Post): FormState {
  return { id: post.id, title: post.title, slug: post.slug, excerpt: post.excerpt ?? "", content_html: post.content_html, publish_status: post.publish_status, cover_image_url: post.cover_image_url ?? null, seo_title: post.seo_title ?? "", seo_description: post.seo_description ?? "", images: post.images.map(({ storage_key, url, alt_text, sort_order }) => ({ storage_key, url, alt_text, sort_order })) };
}

export default function PostsAdminPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [uploads, setUploads] = useState<Record<string, MediaAsset>>({});
  const [cleanup, setCleanup] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const query = useQuery({ queryKey: ["posts-admin"], queryFn: () => adminFetch<Post[]>("/posts") });

  function reset() { setForm(emptyForm()); setUploads({}); setCleanup(new Set()); }
  function edit(post: Post) { setForm(fromPost(post)); setUploads({}); setCleanup(new Set()); window.scrollTo({ top: 0, behavior: "smooth" }); }

  async function uploadImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []); event.target.value = "";
    if (!files.length) return;
    if (form.images.length + files.length > 50) { toast.error("Mỗi bài viết được tối đa 50 ảnh"); return; }
    const error = files.map(file => validateMediaFile(file)).find(Boolean);
    if (error) { toast.error(error); return; }
    setUploading(true);
    try {
      const assets: MediaAsset[] = [];
      for (const file of files) assets.push(await uploadAdminMedia("post-images", file));
      setUploads(current => ({ ...current, ...Object.fromEntries(assets.map(asset => [asset.storage_key, asset])) }));
      setForm(current => {
        const images = [...current.images, ...assets.map((asset, offset) => ({ storage_key: asset.storage_key, url: asset.url, alt_text: current.title, sort_order: current.images.length + offset }))];
        return { ...current, images, cover_image_url: current.cover_image_url ?? images[0]?.url ?? null };
      });
      toast.success(`Đã tải lên ${assets.length} ảnh`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Không thể tải ảnh"); }
    finally { setUploading(false); }
  }

  async function removeImage(index: number) {
    const image = form.images[index];
    const uploaded = uploads[image.storage_key];
    if (uploaded) {
      try { await deleteAdminMedia({ id: uploaded.id }); }
      catch (error) { toast.error(error instanceof Error ? error.message : "Không thể gỡ ảnh"); return; }
      setUploads(current => { const next = { ...current }; delete next[image.storage_key]; return next; });
    } else setCleanup(current => new Set(current).add(image.url));
    setForm(current => {
      const images = current.images.filter((_, itemIndex) => itemIndex !== index).map((item, sort_order) => ({ ...item, sort_order }));
      return { ...current, images, cover_image_url: current.cover_image_url === image.url ? images[0]?.url ?? null : current.cover_image_url };
    });
  }

  const save = useMutation({
    mutationFn: async () => {
      const body = { title: form.title, slug: form.slug, excerpt: form.excerpt || null, content_json: {}, content_html: form.content_html, publish_status: form.publish_status, cover_image_url: form.cover_image_url, seo_title: form.seo_title || null, seo_description: form.seo_description || null, images: form.images };
      return adminFetch<Post>(form.id ? `/posts/${form.id}` : "/posts", { method: form.id ? "PATCH" : "POST", body: JSON.stringify(body) });
    },
    onSuccess: async saved => {
      const failedCleanup = await cleanupMediaUrls(cleanup);
      await queryClient.invalidateQueries({ queryKey: ["posts-admin"] });
      setForm(fromPost(saved)); setUploads({}); setCleanup(new Set(failedCleanup));
      toast.success(form.id ? "Đã cập nhật bài viết" : "Đã tạo bài viết");
      if (failedCleanup.length) toast.warning("Nội dung đã lưu, nhưng có ảnh cũ chưa thể dọn dẹp");
    },
    onError: error => toast.error(error.message),
  });

  const removePost = useMutation({
    mutationFn: (id: string) => adminFetch<void>(`/posts/${id}`, { method: "DELETE" }),
    onSuccess: async () => { reset(); await queryClient.invalidateQueries({ queryKey: ["posts-admin"] }); toast.success("Đã ẩn bài viết"); },
    onError: error => toast.error(error.message),
  });

  return <>
    <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-bold">Bài viết</h1><p className="mt-2 muted">Ảnh được lưu trong Supabase Storage; HTML được backend làm sạch.</p></div>{form.id && <button className="button secondary" type="button" onClick={reset}>Tạo bài mới</button>}</div>
    <form className="mt-8 grid gap-5 rounded-md bg-white p-4 sm:p-6 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
      <div className="grid gap-5">
        <label className="label">Tiêu đề<input required maxLength={260} className="field" value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} /></label>
        <label className="label">Slug<input required maxLength={280} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" className="field" value={form.slug} onChange={event => setForm({ ...form, slug: event.target.value })} /></label>
        <label className="label">Tóm tắt<textarea className="field min-h-24" value={form.excerpt} onChange={event => setForm({ ...form, excerpt: event.target.value })} /></label>
        <label className="label">Nội dung HTML<textarea className="field min-h-72 font-mono text-sm" value={form.content_html} onChange={event => setForm({ ...form, content_html: event.target.value })} /></label>
        <fieldset className="grid gap-4 rounded-md border border-slate-200 p-4"><legend className="px-1 font-bold">Ảnh bài viết</legend><p className="text-sm muted">JPEG, PNG hoặc WebP; tối đa 8 MiB mỗi ảnh.</p><label className="button secondary w-fit cursor-pointer">{uploading ? "Đang tải…" : "Tải ảnh lên"}<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={uploading} onChange={uploadImages} /></label>
          {form.images.length === 0 ? <p className="rounded-md bg-slate-50 p-4 text-sm muted">Chưa có ảnh trong bài viết.</p> : <div className="grid gap-4 sm:grid-cols-2">{form.images.map((image, index) => <div className="rounded-md border border-slate-200 p-3" key={image.storage_key}><Image src={image.url} alt={image.alt_text ?? "Ảnh bài viết"} width={500} height={320} className="aspect-video w-full rounded object-cover" /><label className="label mt-3 text-sm">Mô tả ảnh<input className="field" maxLength={300} value={image.alt_text ?? ""} onChange={event => setForm(current => ({ ...current, images: current.images.map((item, itemIndex) => itemIndex === index ? { ...item, alt_text: event.target.value } : item) }))} /></label><div className="mt-3 flex flex-wrap gap-3"><button type="button" className="text-sm font-bold text-[#1648d8]" onClick={() => setForm({ ...form, cover_image_url: image.url })}>{form.cover_image_url === image.url ? "Ảnh cover" : "Đặt làm cover"}</button><button type="button" className="text-sm font-bold text-red-700" onClick={() => void removeImage(index)}>Gỡ ảnh</button></div></div>)}</div>}
        </fieldset>
      </div>
      <aside className="grid content-start gap-5">
        <label className="label">Trạng thái<select className="field" value={form.publish_status} onChange={event => setForm({ ...form, publish_status: event.target.value as FormState["publish_status"] })}><option value="draft">Bản nháp</option><option value="published">Xuất bản</option></select></label>
        <label className="label">SEO title<input className="field" maxLength={260} value={form.seo_title} onChange={event => setForm({ ...form, seo_title: event.target.value })} /></label>
        <label className="label">SEO description<textarea className="field min-h-24" maxLength={320} value={form.seo_description} onChange={event => setForm({ ...form, seo_description: event.target.value })} /></label>
        <button className="button" disabled={save.isPending || uploading}>{save.isPending ? "Đang lưu…" : form.id ? "Lưu thay đổi" : "Tạo bài viết"}</button>
        {form.id && <button className="button secondary text-red-700" type="button" disabled={removePost.isPending} onClick={() => { if (confirm("Ẩn bài viết này?")) removePost.mutate(form.id!); }}>Ẩn bài viết</button>}
      </aside>
    </form>
    <section className="mt-8"><h2 className="text-xl font-bold">Danh sách bài viết</h2>{query.isPending ? <p className="mt-4">Đang tải bài viết…</p> : query.isError ? <div className="mt-4 rounded-md bg-red-50 p-4 text-red-800">Không thể tải bài viết. <button className="underline" onClick={() => void query.refetch()}>Thử lại</button></div> : query.data.length === 0 ? <p className="mt-4 rounded-md bg-white p-5 muted">Chưa có bài viết.</p> : <div className="mt-4 grid gap-3">{query.data.map(post => <button type="button" onClick={() => edit(post)} key={post.id} className="flex w-full flex-wrap items-center justify-between gap-3 rounded-md bg-white p-4 text-left"><span><span className="block font-semibold">{post.title}</span><span className="text-sm muted">/{post.slug}</span></span><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{post.publish_status === "published" ? "Đã xuất bản" : "Bản nháp"}</span></button>)}</div>}</section>
  </>;
}
