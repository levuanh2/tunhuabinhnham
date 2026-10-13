"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { ChangeEvent, useState } from "react";
import { toast } from "sonner";
import { AdminPageHeader } from "@/components/admin-shell";
import { adminFetch } from "@/lib/admin-api";
import { cleanupMediaUrls, uploadAdminMedia, validateMediaFile } from "@/lib/admin-media";
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
  const [cleanup, setCleanup] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const query = useQuery({ queryKey: ["posts-admin"], queryFn: () => adminFetch<Post[]>("/posts") });

  function reset() { setForm(emptyForm()); setCleanup(new Set()); }
  function edit(post: Post) { setForm(fromPost(post)); setCleanup(new Set()); window.scrollTo({ top: 0, behavior: "smooth" }); }

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
      setForm(current => {
        const images = [...current.images, ...assets.map((asset, offset) => ({ storage_key: asset.storage_key, url: asset.url, alt_text: current.title, sort_order: current.images.length + offset }))];
        return { ...current, images, cover_image_url: current.cover_image_url ?? images[0]?.url ?? null };
      });
      toast.success(`Đã tải lên ${assets.length} ảnh`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Không thể tải ảnh"); }
    finally { setUploading(false); }
  }

  // Removing only changes the form; the file is deleted after a successful save (V1-BUG-01).
  function removeImage(index: number) {
    const image = form.images[index];
    setCleanup(current => new Set(current).add(image.url));
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
      setForm(fromPost(saved)); setCleanup(new Set(failedCleanup));
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
    <AdminPageHeader title={form.id ? "Sửa bài viết" : "Bài viết mới"} description="Nội dung HTML được hệ thống làm sạch trước khi hiển thị." action={form.id && <button className="button secondary" type="button" onClick={reset}>Tạo bài mới</button>} />
    <form className="panel grid gap-5 p-4 sm:p-6 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
      <div className="grid gap-5">
        <label className="label">Tiêu đề<input required maxLength={260} className="field" value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} /></label>
        <label className="label">Slug<input required maxLength={280} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" className="field" value={form.slug} onChange={event => setForm({ ...form, slug: event.target.value })} /></label>
        <label className="label">Tóm tắt<textarea className="field min-h-24" value={form.excerpt} onChange={event => setForm({ ...form, excerpt: event.target.value })} /></label>
        <label className="label">Nội dung HTML<textarea className="field min-h-72 font-mono text-[.8125rem] leading-relaxed" value={form.content_html} onChange={event => setForm({ ...form, content_html: event.target.value })} /></label>
        <fieldset className="grid gap-4 rounded-lg border border-line p-4"><legend className="px-1 text-sm font-semibold">Ảnh bài viết</legend><p className="hint">JPEG, PNG hoặc WebP; tối đa 8 MiB mỗi ảnh.</p><label className="button secondary sm w-fit cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary">{uploading ? "Đang tải…" : "Tải ảnh lên"}<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={uploading} onChange={uploadImages} /></label>
          {form.images.length === 0 ? <p className="rounded-lg border border-dashed border-line-strong p-4 text-center text-sm text-ink-soft">Chưa có ảnh trong bài viết.</p> : <div className="grid gap-4 sm:grid-cols-2">{form.images.map((image, index) => <div className="rounded-lg border border-line p-3" key={image.storage_key}><Image src={image.url} alt={image.alt_text ?? "Ảnh bài viết"} width={500} height={320} className="aspect-video w-full rounded object-cover" /><label className="label mt-3 text-sm">Mô tả ảnh<input className="field" maxLength={300} value={image.alt_text ?? ""} onChange={event => setForm(current => ({ ...current, images: current.images.map((item, itemIndex) => itemIndex === index ? { ...item, alt_text: event.target.value } : item) }))} /></label><div className="mt-3 flex flex-wrap gap-3"><button type="button" className="button ghost sm" onClick={() => setForm({ ...form, cover_image_url: image.url })}>{form.cover_image_url === image.url ? "Ảnh cover" : "Đặt làm cover"}</button><button type="button" className="button ghost sm !text-danger hover:!bg-danger-soft" onClick={() => removeImage(index)}>Gỡ ảnh</button></div></div>)}</div>}
        </fieldset>
      </div>
      <aside className="grid content-start gap-5 rounded-lg bg-bg p-4 xl:sticky xl:top-6">
        <label className="label">Trạng thái<select className="field" value={form.publish_status} onChange={event => setForm({ ...form, publish_status: event.target.value as FormState["publish_status"] })}><option value="draft">Bản nháp</option><option value="published">Xuất bản</option></select></label>
        <label className="label">SEO title<input className="field" maxLength={260} value={form.seo_title} onChange={event => setForm({ ...form, seo_title: event.target.value })} /></label>
        <label className="label">SEO description<textarea className="field min-h-24" maxLength={320} value={form.seo_description} onChange={event => setForm({ ...form, seo_description: event.target.value })} /></label>
        <button className="button" disabled={save.isPending || uploading}>{save.isPending ? "Đang lưu…" : form.id ? "Lưu thay đổi" : "Tạo bài viết"}</button>
        {form.id && <button className="button danger" type="button" disabled={removePost.isPending} onClick={() => { if (confirm("Ẩn bài viết này?")) removePost.mutate(form.id!); }}>Ẩn bài viết</button>}
      </aside>
    </form>
    <section className="mt-8"><h2 className="text-base font-semibold">Danh sách bài viết</h2>{query.isPending ? <p className="mt-4 text-ink-soft">Đang tải bài viết…</p> : query.isError ? <div className="mt-4 alert">Không thể tải bài viết. <button type="button" className="ml-2 font-semibold underline" onClick={() => void query.refetch()}>Thử lại</button></div> : query.data.length === 0 ? <p className="mt-4 panel p-5 text-ink-soft">Chưa có bài viết.</p> : <div className="mt-3 grid gap-2">{query.data.map(post => <button type="button" onClick={() => edit(post)} key={post.id} className={`panel flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left transition-colors hover:border-sand ${form.id === post.id ? "!border-primary" : ""}`} aria-current={form.id === post.id ? "true" : undefined}><span><span className="block font-semibold">{post.title}</span><span className="text-sm text-ink-soft">/tin-tuc/{post.slug}</span></span><span className={`badge ${post.publish_status === "published" ? "success" : ""}`}>{post.publish_status === "published" ? "Đã xuất bản" : "Bản nháp"}</span></button>)}</div>}</section>
  </>;
}
