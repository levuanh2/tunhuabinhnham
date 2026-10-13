"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ImagePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { ChangeEvent, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { AdminApiError, CacheRefreshError, adminFetch } from "@/lib/admin-api";
import { cleanupMediaUrls, deleteAdminMedia, uploadAdminMedia, validateMediaFile } from "@/lib/admin-media";
import { SLUG_PATTERN, skuFromSlug, toPrice, toSlug, withSuffix } from "@/lib/slug";
import type { AdminCategory, MediaAsset, Product, ProductImage } from "@/types/api";

const schema = z.object({
  name: z.string().trim().min(1, "Nhập tên sản phẩm"),
  slug: z.string().min(1, "Tên sản phẩm cần có chữ hoặc số để tạo đường dẫn").regex(SLUG_PATTERN, "Đường dẫn chỉ gồm chữ thường không dấu, số và dấu gạch ngang"),
  sku: z.string().trim().max(80, "Mã sản phẩm tối đa 80 ký tự").regex(/^[A-Za-z0-9._-]*$/, "Mã sản phẩm chỉ gồm chữ không dấu, số và các dấu - _ ."),
  category_id: z.string(),
  price: z.string().refine(value => toPrice(value) !== null, "Nhập giá bằng số, ví dụ 1.250.000"),
  description: z.string(), stock_status: z.enum(["in_stock", "out_of_stock", "contact"]), publish_status: z.enum(["draft", "published"]), is_visible: z.boolean(),
});
type Values = z.infer<typeof schema>;
type EditableImage = Pick<ProductImage, "storage_key" | "url" | "alt_text" | "sort_order" | "is_primary">;
// auto: follows the name (new product). fixed: kept as is (existing product). edit: typed by the admin.
type SlugMode = "auto" | "fixed" | "edit";
const MAX_SUFFIX = 20;

export function ProductForm({ product }: { product?: Product }) {
  const router = useRouter();
  const [images, setImages] = useState<EditableImage[]>(() => product?.images.map(({ storage_key, url, alt_text, sort_order, is_primary }) => ({ storage_key, url, alt_text, sort_order, is_primary })) ?? []);
  const [uploads, setUploads] = useState<Record<string, MediaAsset>>({});
  const [cleanup, setCleanup] = useState<Set<string>>(new Set());
  const [isUploading, setIsUploading] = useState(false);
  const categories = useQuery({ queryKey: ["categories"], queryFn: () => adminFetch<AdminCategory[]>("/categories") });
  const { register, handleSubmit, setValue, setError, setFocus, control, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema), mode: "onTouched", defaultValues: { name: product?.name ?? "", slug: product?.slug ?? "", sku: product?.sku ?? "", category_id: product?.category_id ?? product?.category?.id ?? "", price: product?.price?.replace(/\.0+$/, "") ?? "", description: product?.description ?? "", stock_status: product?.stock_status ?? "contact", publish_status: product?.publish_status ?? "draft", is_visible: product?.is_visible ?? true } });
  const [slugMode, setSlugMode] = useState<SlugMode>(product ? "fixed" : "auto");
  // There is no redirect from old product URLs yet, so a product that was ever public keeps its URL.
  const slugLocked = Boolean(product && (product.published_at || product.publish_status === "published"));
  const [slug, name, publishStatus, isVisible, categoryId] = useWatch({ control, name: ["slug", "name", "publish_status", "is_visible", "category_id"] });
  const hiddenCategory = categories.data?.find(category => category.id === categoryId && !category.is_visible);
  // Publishing for the first time fixes the URL for good (no redirects yet), so it must be checked first.
  const firstPublish = publishStatus === "published" && !slugLocked;

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

  function editSlug() { setSlugMode("edit"); setTimeout(() => setFocus("slug")); }
  function autoSlug() { setSlugMode("auto"); setValue("slug", toSlug(name), { shouldValidate: true }); }

  async function submit(values: Values) {
    const body = { ...values, sku: values.sku.trim(), category_id: values.category_id || null, price: toPrice(values.price) || null, attributes: product?.attributes ?? {}, images };
    // The database unique constraints are the final check. On a conflict, generated values get -2, -3...
    // (this also covers two admins saving the same name at once); values the admin typed are reported instead.
    const generatedSku = !body.sku;
    let finalSlug = values.slug, sku = body.sku || skuFromSlug(finalSlug), cacheStale = false;
    for (let attempt = 2; ; attempt++) {
      try {
        await adminFetch(product ? `/products/${product.id}` : "/products", { method: product ? "PATCH" : "POST", body: JSON.stringify({ ...body, slug: finalSlug, sku }) });
        break;
      } catch (error) {
        if (error instanceof CacheRefreshError) { cacheStale = true; break; } // already saved: never send it twice
        const conflict = error instanceof AdminApiError && error.status === 409 && attempt <= MAX_SUFFIX ? error.message : null;
        if (conflict === "Slug already exists" && slugMode === "auto") { finalSlug = withSuffix(values.slug, attempt); if (generatedSku) sku = skuFromSlug(finalSlug); continue; }
        if (conflict === "SKU already exists" && generatedSku) { sku = withSuffix(skuFromSlug(finalSlug), attempt, 80); continue; }
        return showSaveError(error);
      }
    }
    const failedCleanup = await cleanupMediaUrls(cleanup);
    toast.success(product ? "Đã lưu sản phẩm" : "Đã tạo sản phẩm");
    if (finalSlug !== values.slug) toast.info(`Đường dẫn “${values.slug}” đã có sản phẩm khác dùng, nên sản phẩm này dùng /san-pham/${finalSlug}`);
    if (cacheStale) toast.warning("Đã lưu. Trang web công khai sẽ tự cập nhật trong vòng 5 phút");
    if (failedCleanup.length) toast.warning("Sản phẩm đã lưu, nhưng có ảnh cũ chưa thể dọn dẹp");
    router.push("/admin/san-pham"); router.refresh();
  }

  function showSaveError(error: unknown) {
    if (error instanceof AdminApiError && error.message === "Slug already exists") {
      setSlugMode("edit");
      setError("slug", { message: "Đường dẫn này đã có sản phẩm khác dùng. Hãy thêm số hoặc chữ ở cuối, ví dụ …-2" }, { shouldFocus: true });
    } else if (error instanceof AdminApiError && error.message === "Published product URL cannot change" && product) {
      // Someone published it after this form was opened: keep the public URL.
      setSlugMode("fixed"); setValue("slug", product.slug);
      setError("slug", { message: "Sản phẩm này đã được đăng nên giữ đường dẫn cũ. Bấm lưu lại để lưu các thay đổi khác." });
    } else if (error instanceof AdminApiError && error.message === "SKU already exists") {
      setError("sku", { message: "Mã sản phẩm này đã dùng cho sản phẩm khác" }, { shouldFocus: true });
    } else if (error instanceof AdminApiError && error.message === "Category not found") {
      void categories.refetch();
      setError("category_id", { message: "Loại sản phẩm này vừa bị xóa. Hãy chọn loại khác." }, { shouldFocus: true });
    } else toast.error(error instanceof Error ? error.message : "Không thể lưu");
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
        <label className="label">Tên sản phẩm<input className="field" aria-invalid={errors.name ? true : undefined} {...register("name", { onChange: event => { if (slugMode === "auto") setValue("slug", toSlug(event.target.value), { shouldValidate: Boolean(errors.slug) }); } })} />{fieldError(errors.name?.message)}</label>
        <div className="grid gap-1.5">
          {slugMode === "edit"
            ? <label className="label">Đường dẫn sản phẩm<span className="flex items-center gap-1"><span className="text-sm font-normal text-ink-soft" aria-hidden="true">/san-pham/</span><input className="field min-w-0 flex-1" aria-invalid={errors.slug ? true : undefined} aria-describedby="duong-dan-goi-y" autoCapitalize="none" spellCheck={false} {...register("slug")} /></span></label>
            : <><span className="label" id="duong-dan-nhan">Đường dẫn sản phẩm</span>
                <p className="flex flex-wrap items-center gap-x-3 text-sm"><output aria-labelledby="duong-dan-nhan" aria-describedby="duong-dan-goi-y" className="min-w-0 break-all rounded-md bg-muted px-2.5 py-1.5">/san-pham/{slug || "…"}</output>{!slugLocked && <button type="button" className="link min-h-11 font-medium" onClick={editSlug}>Chỉnh sửa đường dẫn</button>}</p></>}
          {fieldError(errors.slug?.message)}
          <span id="duong-dan-goi-y" className="hint">{
            firstPublish ? "Kiểm tra kỹ: sau khi đăng, đường dẫn này sẽ không đổi được."
            : slugMode === "auto" ? "Tự tạo từ tên sản phẩm."
            : slugLocked ? "Sản phẩm đã đăng nên giữ nguyên đường dẫn, để các link khách đã lưu hoặc chia sẻ không bị hỏng."
            : slugMode === "fixed" ? "Đổi tên sản phẩm không làm thay đổi đường dẫn."
            : product ? "Lưu ý: đổi đường dẫn sẽ đổi địa chỉ trang của sản phẩm này."
            : "Đường dẫn sẽ không tự đổi theo tên nữa."}
            {slugMode === "edit" && !product && <> <button type="button" className="link font-medium" onClick={autoSlug}>Tạo lại từ tên</button></>}
          </span>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="label">Mã sản phẩm (không bắt buộc)<input className="field" placeholder="Ví dụ TN-5T-001" autoCapitalize="characters" spellCheck={false} aria-invalid={errors.sku ? true : undefined} {...register("sku")} />{errors.sku ? fieldError(errors.sku.message) : <span className="hint">Mã riêng để phân biệt và quản lý các mẫu tủ. Để trống thì hệ thống tự tạo.</span>}</label>
          <label className="label">Giá bán (VNĐ)<input className="field" inputMode="numeric" placeholder="Ví dụ 1.250.000" aria-invalid={errors.price ? true : undefined} {...register("price")} />{errors.price ? fieldError(errors.price.message) : <span className="hint">Để trống nếu muốn khách liên hệ hỏi giá.</span>}</label>
        </div>
        <div className="grid gap-1.5">
          {/* key: remount once options load so react-hook-form re-applies the saved category instead of submitting "" */}
          <label className="label">Loại sản phẩm<select key={categories.data ? "ready" : "loading"} className="field" aria-invalid={errors.category_id ? true : undefined} {...register("category_id")}><option value="">Chọn loại tủ</option>{categories.data?.map(category => <option value={category.id} key={category.id}>{category.is_visible ? category.name : `${category.name} (đang ẩn)`}</option>)}</select></label>
          {errors.category_id ? fieldError(errors.category_id.message) : categories.isError ? <span className="error">Không thể tải loại sản phẩm</span> : categories.data?.length === 0 && <span className="hint">Chưa có loại sản phẩm nào. Có thể lưu trước rồi chọn loại sau.</span>}
          <Link href="/admin/danh-muc" target="_blank" className="link w-fit text-sm font-medium">Quản lý loại sản phẩm<span className="sr-only"> (mở tab mới)</span></Link>
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
      <h2 className="text-base font-semibold">Đăng bán</h2>
      <label className="label">Trạng thái đăng bán<select className="field" {...register("publish_status")}><option value="draft">Chưa đăng</option><option value="published">Đăng bán</option></select></label>
      <label className="label">Tình trạng hàng<select className="field" {...register("stock_status")}><option value="in_stock">Còn hàng</option><option value="out_of_stock">Hết hàng</option><option value="contact">Liên hệ</option></select></label>
      <div className="grid gap-1"><label className="flex min-h-11 items-center gap-3 text-sm font-medium"><input type="checkbox" className="size-5" {...register("is_visible")} />Hiển thị trên website</label><span className="hint">Bỏ chọn để tạm ẩn sản phẩm mà không cần gỡ đăng.</span></div>
      <p className="rounded-lg bg-muted px-3 py-2.5 text-sm" aria-live="polite">{publishStatus === "draft" ? "Chưa đăng: khách chưa thấy sản phẩm này." : !isVisible ? "Đã đăng nhưng đang ẩn: khách chưa thấy sản phẩm này." : hiddenCategory ? `Loại “${hiddenCategory.name}” đang ẩn: khách chưa thấy sản phẩm này.` : "Khách xem được sản phẩm này trên website."}</p>
      {firstPublish && <div role="note" className="grid gap-1 rounded-lg border border-line-strong px-3 py-2.5 text-sm"><span className="font-semibold">Kiểm tra đường dẫn trước khi đăng</span><span className="break-all font-medium text-primary">/san-pham/{slug || "…"}</span><span className="text-ink-soft">Sau khi đăng, đường dẫn này được giữ cố định để link khách đã lưu hoặc chia sẻ không bị hỏng.</span></div>}
      <button className="button w-full" aria-busy={isSubmitting || undefined} disabled={isSubmitting || isUploading}>{isSubmitting ? "Đang lưu…" : publishStatus === "draft" ? "Lưu bản nháp" : product?.publish_status === "published" ? "Lưu thay đổi" : "Đăng sản phẩm"}</button>
    </aside>
  </form>;
}
