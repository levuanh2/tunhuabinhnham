"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Image from "next/image";
import { ArrowLeft, ArrowRight, ImagePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { ChangeEvent, useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { adminFetch } from "@/lib/admin-api";
import { cleanupMediaUrls, deleteAdminMedia, uploadAdminMedia, validateMediaFile } from "@/lib/admin-media";
import type { Category, MediaAsset, Product, ProductImage } from "@/types/api";

const schema = z.object({ name: z.string().min(1, "Nhập tên sản phẩm"), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug chỉ gồm chữ thường, số và dấu gạch"), sku: z.string().min(1), category_id: z.string(), price: z.string(), description: z.string(), stock_status: z.enum(["in_stock", "out_of_stock", "contact"]), publish_status: z.enum(["draft", "published"]), is_visible: z.boolean() });
type Values = z.infer<typeof schema>;
type EditableImage = Pick<ProductImage, "storage_key" | "url" | "alt_text" | "sort_order" | "is_primary">;

export function ProductForm({ product }: { product?: Product }) {
  const router = useRouter();
  const [images, setImages] = useState<EditableImage[]>(() => product?.images.map(({ storage_key, url, alt_text, sort_order, is_primary }) => ({ storage_key, url, alt_text, sort_order, is_primary })) ?? []);
  const [uploads, setUploads] = useState<Record<string, MediaAsset>>({});
  const [cleanup, setCleanup] = useState<Set<string>>(new Set());
  const [isUploading, setIsUploading] = useState(false);
  const categories = useQuery({ queryKey: ["categories"], queryFn: () => adminFetch<Category[]>("/categories") });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: product?.name ?? "", slug: product?.slug ?? "", sku: product?.sku ?? "", category_id: product?.category_id ?? product?.category?.id ?? "", price: product?.price ?? "", description: product?.description ?? "", stock_status: product?.stock_status ?? "contact", publish_status: product?.publish_status ?? "draft", is_visible: product?.is_visible ?? true } });

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    if (images.length + files.length > 20) { toast.error("Mỗi sản phẩm được tối đa 20 ảnh"); return; }
    const invalid = files.map(file => validateMediaFile(file)).find(Boolean);
    if (invalid) { toast.error(invalid); return; }
    setIsUploading(true);
    try {
      const uploaded: EditableImage[] = [];
      for (const file of files) {
        const asset = await uploadAdminMedia("product-images", file);
        setUploads(current => ({ ...current, [asset.storage_key]: asset }));
        uploaded.push({ storage_key: asset.storage_key, url: asset.url, alt_text: product?.name ?? "", sort_order: images.length + uploaded.length, is_primary: images.length === 0 && uploaded.length === 0 });
      }
      setImages(current => [...current, ...uploaded]);
      toast.success(`Đã tải lên ${uploaded.length} ảnh`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Không thể tải ảnh lên"); }
    finally { setIsUploading(false); }
  }

  async function removeImage(index: number) {
    const image = images[index];
    const uploaded = uploads[image.storage_key];
    if (uploaded) {
      try { await deleteAdminMedia({ id: uploaded.id }); }
      catch (error) { toast.error(error instanceof Error ? error.message : "Không thể gỡ ảnh"); return; }
      setUploads(current => { const next = { ...current }; delete next[image.storage_key]; return next; });
    } else setCleanup(current => new Set(current).add(image.url));
    setImages(current => {
      const remaining = current.filter((_, itemIndex) => itemIndex !== index);
      const hasPrimary = remaining.some(item => item.is_primary);
      return remaining.map((image, itemIndex) => ({ ...image, sort_order: itemIndex, is_primary: hasPrimary ? image.is_primary : itemIndex === 0 }));
    });
  }

  async function submit(values: Values) {
    try {
      const body = { ...values, category_id: values.category_id || null, price: values.price || null, attributes: product?.attributes ?? {}, images };
      await adminFetch(product ? `/products/${product.id}` : "/products", { method: product ? "PATCH" : "POST", body: JSON.stringify(body) });
      const failedCleanup = await cleanupMediaUrls(cleanup);
      toast.success(product ? "Đã lưu sản phẩm" : "Đã tạo sản phẩm");
      if (failedCleanup.length) toast.warning("Sản phẩm đã lưu, nhưng có ảnh cũ chưa thể dọn dẹp");
      router.push("/admin/san-pham"); router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Không thể lưu"); }
  }

  function moveImage(index: number, offset: -1 | 1) {
    setImages(current => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((item, sort_order) => ({ ...item, sort_order }));
    });
  }

  const fieldError = (message?: string) => message ? <span className="error">{message}</span> : null;

  return <form className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start" onSubmit={handleSubmit(submit)}>
    <div className="grid gap-6">
      <section className="panel grid gap-5 p-5 sm:p-6" aria-labelledby="thong-tin">
        <h2 id="thong-tin" className="text-base font-semibold">Thông tin</h2>
        <label className="label">Tên sản phẩm<input className="field" aria-invalid={errors.name ? true : undefined} {...register("name")} />{fieldError(errors.name?.message)}</label>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="label">Slug<input className="field" aria-invalid={errors.slug ? true : undefined} {...register("slug")} />{errors.slug ? fieldError(errors.slug.message) : <span className="hint">Dùng trong đường dẫn: /san-pham/slug</span>}</label>
          <label className="label">SKU<input className="field" aria-invalid={errors.sku ? true : undefined} {...register("sku")} />{fieldError(errors.sku && "Nhập mã SKU")}</label>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {/* key: remount once options load so react-hook-form re-applies the saved category instead of submitting "" */}
          <label className="label">Danh mục<select key={categories.data ? "ready" : "loading"} className="field" {...register("category_id")}><option value="">Chưa phân loại</option>{categories.data?.map(category => <option value={category.id} key={category.id}>{category.name}</option>)}</select>{categories.isError && <span className="error">Không thể tải danh mục</span>}</label>
          <label className="label">Giá (VNĐ)<input className="field" inputMode="numeric" placeholder="Để trống nếu cần liên hệ" {...register("price")} /></label>
        </div>
        <label className="label">Mô tả<textarea className="field min-h-36 leading-relaxed" {...register("description")} /></label>
      </section>

      <fieldset className="panel grid gap-4 p-5 sm:p-6">
        <legend className="sr-only">Ảnh sản phẩm</legend>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-base font-semibold" aria-hidden="true">Ảnh sản phẩm</h2><p className="hint mt-0.5">JPEG, PNG hoặc WebP; tối đa 8 MiB mỗi ảnh và 20 ảnh. {images.length}/20</p></div>
          <label className={`button secondary sm cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${isUploading || images.length >= 20 ? "pointer-events-none opacity-55" : ""}`}><ImagePlus size={16} aria-hidden="true" />{isUploading ? "Đang tải ảnh lên…" : "Tải ảnh lên"}<input className="sr-only" aria-label="Ảnh sản phẩm" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={isUploading} onChange={upload} /></label>
        </div>
        {images.length === 0
          ? <p className="rounded-lg border border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-soft">Chưa có ảnh. Ảnh đầu tiên sẽ là ảnh chính.</p>
          : <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{images.map((image, index) => <li className="overflow-hidden rounded-lg border border-line" key={image.storage_key}>
              <div className="relative aspect-[4/3] bg-muted"><Image src={image.url} alt={image.alt_text ?? "Ảnh sản phẩm"} fill sizes="(min-width: 1280px) 20vw, (min-width: 640px) 40vw, 100vw" className="object-cover" />{image.is_primary && <span className="badge success absolute left-2 top-2">Ảnh chính</span>}</div>
              <div className="grid gap-3 p-3">
                <label className="label text-[.8125rem]">Mô tả ảnh<input className="field min-h-10" value={image.alt_text ?? ""} onChange={event => setImages(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, alt_text: event.target.value } : item))} /></label>
                <div className="flex flex-wrap items-center gap-1">
                  <button className="grid size-9 place-items-center rounded-full text-ink-soft hover:bg-muted disabled:opacity-35" type="button" disabled={index === 0} onClick={() => moveImage(index, -1)} aria-label={`Đưa ảnh ${index + 1} lên trước`}><ArrowLeft size={16} aria-hidden="true" /></button>
                  <button className="grid size-9 place-items-center rounded-full text-ink-soft hover:bg-muted disabled:opacity-35" type="button" disabled={index === images.length - 1} onClick={() => moveImage(index, 1)} aria-label={`Đưa ảnh ${index + 1} ra sau`}><ArrowRight size={16} aria-hidden="true" /></button>
                  <button className="button ghost sm ml-auto !text-danger hover:!bg-danger-soft" type="button" onClick={() => void removeImage(index)}>Gỡ ảnh</button>
                </div>
                {!image.is_primary && <button className="button secondary sm w-full" type="button" onClick={() => setImages(current => current.map((item, itemIndex) => ({ ...item, is_primary: itemIndex === index })))}>Đặt làm ảnh chính</button>}
              </div>
            </li>)}</ul>}
      </fieldset>
    </div>

    <aside className="panel grid gap-5 p-5 lg:sticky lg:top-6">
      <h2 className="text-base font-semibold">Hiển thị</h2>
      <label className="label">Xuất bản<select className="field" {...register("publish_status")}><option value="draft">Bản nháp</option><option value="published">Xuất bản</option></select></label>
      <label className="label">Tình trạng<select className="field" {...register("stock_status")}><option value="in_stock">Còn hàng</option><option value="out_of_stock">Hết hàng</option><option value="contact">Liên hệ</option></select></label>
      <label className="flex items-center gap-3 text-sm font-medium"><input type="checkbox" {...register("is_visible")} />Hiển thị sản phẩm trên website</label>
      <button className="button w-full" disabled={isSubmitting || isUploading}>{isSubmitting ? "Đang lưu…" : "Lưu sản phẩm"}</button>
    </aside>
  </form>;
}
