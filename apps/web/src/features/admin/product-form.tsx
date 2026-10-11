"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Image from "next/image";
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

  return <form className="mt-8 grid max-w-3xl gap-6 rounded-md bg-white p-6" onSubmit={handleSubmit(submit)}>
    <label className="label">Tên sản phẩm<input className="field" {...register("name")} />{errors.name && <span className="error">{errors.name.message}</span>}</label>
    <div className="grid gap-5 sm:grid-cols-2"><label className="label">Slug<input className="field" {...register("slug")} />{errors.slug && <span className="error">{errors.slug.message}</span>}</label><label className="label">SKU<input className="field" {...register("sku")} /></label></div>
    <div className="grid gap-5 sm:grid-cols-2"><label className="label">Danh mục<select className="field" {...register("category_id")}><option value="">Chưa phân loại</option>{categories.data?.map(category => <option value={category.id} key={category.id}>{category.name}</option>)}</select>{categories.isError && <span className="error">Không thể tải danh mục</span>}</label><label className="label">Giá (để trống nếu cần liên hệ)<input className="field" inputMode="numeric" {...register("price")} /></label></div>
    <label className="label">Mô tả<textarea className="field min-h-36" {...register("description")} /></label>
    <fieldset className="grid gap-4"><legend className="font-bold">Ảnh sản phẩm</legend><p className="text-sm muted">JPEG, PNG hoặc WebP; tối đa 8 MiB mỗi ảnh và 20 ảnh.</p><input aria-label="Ảnh sản phẩm" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={isUploading} onChange={upload} />{isUploading && <p>Đang tải ảnh lên…</p>}<div className="grid gap-4 sm:grid-cols-2">{images.map((image, index) => <div className="rounded-md border border-slate-200 p-3" key={image.storage_key}><Image src={image.url} alt={image.alt_text ?? "Ảnh sản phẩm"} width={400} height={300} className="aspect-4/3 w-full rounded object-cover" /><label className="label mt-3">Mô tả ảnh<input className="field" value={image.alt_text ?? ""} onChange={event => setImages(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, alt_text: event.target.value } : item))} /></label><div className="mt-3 flex gap-3"><button className="text-sm font-bold text-[#1648d8]" type="button" onClick={() => setImages(current => current.map((item, itemIndex) => ({ ...item, is_primary: itemIndex === index })))}>{image.is_primary ? "Ảnh chính" : "Đặt làm ảnh chính"}</button><button className="text-sm font-bold text-red-700" type="button" onClick={() => void removeImage(index)}>Gỡ ảnh</button></div></div>)}</div></fieldset>
    <div className="grid gap-5 sm:grid-cols-2"><label className="label">Tình trạng<select className="field" {...register("stock_status")}><option value="in_stock">Còn hàng</option><option value="out_of_stock">Hết hàng</option><option value="contact">Liên hệ</option></select></label><label className="label">Xuất bản<select className="field" {...register("publish_status")}><option value="draft">Bản nháp</option><option value="published">Xuất bản</option></select></label></div>
    <label className="flex gap-3"><input type="checkbox" {...register("is_visible")} />Hiển thị sản phẩm</label><div><button className="button" disabled={isSubmitting || isUploading}>{isSubmitting ? "Đang lưu…" : "Lưu sản phẩm"}</button></div>
  </form>;
}
