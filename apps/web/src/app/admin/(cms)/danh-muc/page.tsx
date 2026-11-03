"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";
import { FormEvent, useState } from "react";
import { toast } from "sonner";
import { AdminPageHeader, QueryError } from "@/components/admin-shell";
import { AdminApiError, CacheRefreshError, adminFetch } from "@/lib/admin-api";
import { toSlug, withSuffix } from "@/lib/slug";
import type { AdminCategory } from "@/types/api";

// Starting suggestions only: every category is ordinary CMS data the owner can rename, hide or delete.
const SUGGESTIONS = ["Tủ quần áo", "Tủ ngăn kéo", "Tủ giày dép", "Tủ nhựa trẻ em", "Tủ đa năng", "Kệ nhựa"];
const CATEGORY_SLUG_MAX = 180;
const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase("vi") === b.trim().toLocaleLowerCase("vi");

export default function CategoriesPage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["categories"], queryFn: () => adminFetch<AdminCategory[]>("/categories") });
  const items = query.data ?? [];
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; description: string; error?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  /** Runs one change; a failed cache refresh still means the change is saved. */
  async function run(key: string, change: () => Promise<unknown>, success: string) {
    setBusy(key);
    try { await change(); toast.success(success); return true; }
    catch (error) {
      if (error instanceof CacheRefreshError) { toast.warning(`${success}. Trang web công khai sẽ tự cập nhật trong vòng 12 giờ`); return true; }
      toast.error(error instanceof Error ? error.message : "Không thể lưu thay đổi");
      return false;
    } finally {
      setBusy(null);
      // Product lists embed the category (e.g. the "Loại đang ẩn" badge), so they are stale too.
      await Promise.all([client.invalidateQueries({ queryKey: ["categories"] }), client.invalidateQueries({ queryKey: ["admin-products"] })]);
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    const slug = toSlug(name, CATEGORY_SLUG_MAX);
    if (!slug) return setCreateError("Tên loại cần có chữ hoặc số");
    const existing = items.find(item => sameName(item.name, name) || item.slug === slug);
    if (existing) return setCreateError(`Đã có loại “${existing.name}”`);
    setCreateError(null);
    const sort_order = Math.max(-1, ...items.map(item => item.sort_order)) + 1;
    const saved = await run("create", async () => {
      // A deleted category keeps its slug in the database, so a slug missing from the list can still conflict.
      for (let attempt = 1; ; attempt++) {
        const candidate = attempt === 1 ? slug : withSuffix(slug, attempt, CATEGORY_SLUG_MAX);
        try { return await adminFetch("/categories", { method: "POST", body: JSON.stringify({ name: name.trim(), slug: candidate, description: description.trim() || null, is_visible: true, sort_order }) }); }
        catch (error) { if (!(error instanceof AdminApiError && error.message === "Slug already exists" && attempt < 20)) throw error; }
      }
    }, `Đã thêm loại “${name.trim()}”`);
    if (saved) { setName(""); setDescription(""); }
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    if (!editing.name.trim()) return setEditing({ ...editing, error: "Nhập tên loại" });
    const duplicate = items.find(item => item.id !== editing.id && sameName(item.name, editing.name));
    if (duplicate) return setEditing({ ...editing, error: `Đã có loại “${duplicate.name}”` });
    // The slug is kept, so shared links like /san-pham?category=tu-quan-ao keep working after a rename.
    if (await run(editing.id, () => adminFetch(`/categories/${editing.id}`, { method: "PATCH", body: JSON.stringify({ name: editing.name.trim(), description: editing.description.trim() || null }) }), "Đã lưu loại sản phẩm")) setEditing(null);
  }

  function move(index: number, offset: -1 | 1) {
    const order = [...items];
    [order[index], order[index + offset]] = [order[index + offset], order[index]];
    // Rewrites positions 0..n-1, which also untangles categories that all share sort_order 0.
    const changed = order.map((item, sort_order) => ({ item, sort_order })).filter(({ item, sort_order }) => item.sort_order !== sort_order);
    void run(items[index].id, () => Promise.all(changed.map(({ item, sort_order }) => adminFetch(`/categories/${item.id}`, { method: "PATCH", body: JSON.stringify({ sort_order }) }))), "Đã đổi thứ tự");
  }

  function remove(item: AdminCategory) {
    // An API without product counts (older backend) must not allow a delete it cannot check.
    if (typeof item.product_count !== "number") {
      toast.error("Chưa kiểm tra được số sản phẩm của loại này. Hãy thử lại sau khi hệ thống cập nhật.");
      return;
    }
    if (item.product_count > 0) {
      toast.error(`“${item.name}” đang có ${item.product_count} sản phẩm. Hãy chuyển các sản phẩm này sang loại khác trước khi xóa, hoặc chọn Ẩn.`);
      return;
    }
    if (!confirm(`Xóa loại “${item.name}”? Khách sẽ không còn thấy loại này trên website.`)) return;
    void run(item.id, () => adminFetch(`/categories/${item.id}`, { method: "DELETE" }).catch(error => {
      if (error instanceof AdminApiError && error.message === "Category has products") throw new Error(`“${item.name}” vừa có sản phẩm được thêm vào. Hãy chuyển sản phẩm sang loại khác trước khi xóa.`);
      throw error;
    }), `Đã xóa loại “${item.name}”`);
  }

  function toggleVisible(item: AdminCategory) {
    if (item.is_visible && !confirm(`Ẩn loại “${item.name}”? ${typeof item.product_count === "number" ? item.product_count : "Các"} sản phẩm thuộc loại này sẽ bị ẩn khỏi website (danh sách, tìm kiếm, trang chi tiết). Link đã chia sẻ tới các sản phẩm này sẽ báo không tìm thấy cho đến khi bạn hiện lại loại; trạng thái từng sản phẩm được giữ nguyên.

Nếu chỉ tạm hết hàng, hãy giữ loại và đặt “Tình trạng hàng: Hết hàng” cho sản phẩm để link vẫn hoạt động.`)) return;
    void run(item.id, () => adminFetch(`/categories/${item.id}`, { method: "PATCH", body: JSON.stringify({ is_visible: !item.is_visible }) }), item.is_visible ? `Đã ẩn “${item.name}”` : `Đã hiện “${item.name}”`);
  }

  const suggestions = SUGGESTIONS.filter(suggestion => !items.some(item => sameName(item.name, suggestion) || item.slug === toSlug(suggestion)));
  const preview = toSlug(name, CATEGORY_SLUG_MAX);
  const iconButton = "grid size-11 place-items-center rounded-full text-ink-soft hover:bg-muted disabled:opacity-35";

  return <>
    <AdminPageHeader title="Loại sản phẩm" description="Nhóm sản phẩm theo công dụng. Khách dùng các loại này để lọc trên trang Sản phẩm và trang chủ." />
    <form className="panel grid gap-4 p-5 sm:p-6" onSubmit={create} noValidate>
      <h2 className="text-base font-semibold">Thêm loại sản phẩm</h2>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] md:items-start">
        <label className="label">Tên loại<input className="field" value={name} aria-invalid={createError ? true : undefined} placeholder="Ví dụ Tủ quần áo" onChange={event => { setName(event.target.value); setCreateError(null); }} />
          {createError ? <span className="error">{createError}</span> : <span className="hint">{preview ? `Đường dẫn lọc: /san-pham?category=${preview}` : "Đường dẫn được tạo tự động từ tên."}</span>}</label>
        <label className="label">Mô tả ngắn (không bắt buộc)<input className="field" value={description} onChange={event => setDescription(event.target.value)} placeholder="Hiện dưới tiêu đề khi khách lọc theo loại này" /></label>
        <button className="button md:mt-[1.6rem]" disabled={busy === "create" || !name.trim()}>{busy === "create" ? "Đang thêm…" : "Thêm loại"}</button>
      </div>
      {query.isSuccess && suggestions.length > 0 && <div className="flex flex-wrap items-center gap-2 text-sm"><span className="text-ink-soft">Gợi ý:</span>{suggestions.map(suggestion => <button key={suggestion} type="button" className="button secondary sm" onClick={() => { setName(suggestion); setCreateError(null); }}>{suggestion}</button>)}</div>}
    </form>

    <div className="mt-6">
      {query.isPending ? <p className="text-ink-soft">Đang tải loại sản phẩm…</p>
        : query.isError ? <QueryError label="loại sản phẩm" onRetry={() => void query.refetch()} />
        : items.length === 0 ? <div className="panel px-6 py-12 text-center text-ink-soft">Chưa có loại sản phẩm. Thêm loại đầu tiên ở phía trên, hoặc bấm một gợi ý.</div>
        : <ul className="panel divide-y divide-line">{items.map((item, index) => <li key={item.id} className="grid gap-3 px-4 py-3 sm:flex sm:items-center sm:justify-between">
            {editing?.id === item.id
              ? <form className="grid flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] md:items-start" onSubmit={saveEdit} noValidate>
                  <label className="label">Tên loại<input className="field" autoFocus value={editing.name} aria-invalid={editing.error ? true : undefined} onChange={event => setEditing({ ...editing, name: event.target.value, error: undefined })} />{editing.error && <span className="error">{editing.error}</span>}</label>
                  <label className="label">Mô tả ngắn<input className="field" value={editing.description} onChange={event => setEditing({ ...editing, description: event.target.value })} /></label>
                  <div className="flex gap-2 md:mt-[1.6rem]"><button className="button sm" disabled={busy === item.id}>{busy === item.id ? "Đang lưu…" : "Lưu"}</button><button type="button" className="button ghost sm" onClick={() => setEditing(null)}>Hủy</button></div>
                </form>
              : <>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium"><span>{item.name}</span>{!item.is_visible && <span className="badge">Đang ẩn</span>}</p>
                    {item.description && <p className="mt-0.5 line-clamp-2 text-sm text-ink-soft">{item.description}</p>}
                    <p className="mt-0.5 text-sm text-ink-soft">{typeof item.product_count === "number" ? `${item.product_count} sản phẩm` : "Chưa rõ số sản phẩm"} · <span className="break-all">/san-pham?category={item.slug}</span></p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1 sm:shrink-0">
                    <button type="button" className={iconButton} disabled={index === 0 || busy !== null} onClick={() => move(index, -1)} aria-label={`Đưa ${item.name} lên trên`}><ArrowUp size={16} aria-hidden="true" /></button>
                    <button type="button" className={iconButton} disabled={index === items.length - 1 || busy !== null} onClick={() => move(index, 1)} aria-label={`Đưa ${item.name} xuống dưới`}><ArrowDown size={16} aria-hidden="true" /></button>
                    <button type="button" className="button ghost sm" onClick={() => setEditing({ id: item.id, name: item.name, description: item.description ?? "" })} aria-label={`Sửa loại ${item.name}`}>Sửa</button>
                    <button type="button" className="button ghost sm" disabled={busy !== null} onClick={() => toggleVisible(item)} aria-label={`${item.is_visible ? "Ẩn" : "Hiện"} loại ${item.name}`}>{item.is_visible ? "Ẩn" : "Hiện"}</button>
                    <button type="button" className="button ghost sm !text-danger hover:!bg-danger-soft" disabled={busy !== null} onClick={() => remove(item)} aria-label={`Xóa loại ${item.name}`}>Xóa</button>
                  </div>
                </>}
          </li>)}</ul>}
      <p className="hint mt-3">Ẩn: loại và các sản phẩm thuộc loại đó không còn hiện trên website (link cũ báo không tìm thấy); trạng thái từng sản phẩm được giữ nguyên. Chỉ ẩn khi ngừng bán; tạm hết hàng thì đặt “Tình trạng hàng: Hết hàng”. Chỉ xóa được loại không còn sản phẩm nào.</p>
    </div>
  </>;
}
