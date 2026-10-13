// QA fixture server for UI/visual tests ONLY. Read-only fake of the public + admin API and a fake
// Supabase Auth (token/user/logout) so the admin UI can render locally without real credentials.
// Binds 127.0.0.1. Never point a deployed environment at it. Images are inline SVG data URIs.
// Run: node apps/web/e2e/fixtures/mock-api.mjs   (PORT defaults to 8100; MOCK_EMPTY=1 for empty-state data)
// Login on the fake auth: any email + password "qa-password-123".
import http from "node:http";
const PALETTE = { "tu-5-tang": ["#ece5da", "#fafaf8", 5, 1], "tu-ao-3-canh": ["#e2e8e4", "#f0ece4", 1, 3], "tu-giay": ["#f0e2d6", "#ffffff", 4, 2], "ke-bep": ["#e7e3f0", "#f6f4fa", 3, 1],
  "tu-tre-em": ["#f5e7d6", "#d6e8f0", 4, 1], "hop-dung-do": ["#e4eae2", "#fffcf6", 2, 2], "tu-ao-2-canh": ["#eee9e2", "#d8c9b6", 1, 2], "tu-ngan-keo": ["#e8e4de", "#faf5ee", 6, 1] };
function cabinet(name) {
  const [bg, body, rows, cols] = PALETTE[name] ?? ["#ece5da", "#fafaf8", 3, 1];
  const cw = 420 / cols, rh = 730 / rows; let cells = "";
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells += `<rect x="${240 + c * cw + 6}" y="${210 + r * rh + 6}" width="${cw - 12}" height="${rh - 12}" rx="10" fill="none" stroke="#00000030" stroke-width="3"/>`;
  return svg(900, 1125, `<rect width="900" height="1125" fill="${bg}"/><ellipse cx="450" cy="985" rx="280" ry="25" fill="#00000018"/><rect x="220" y="180" width="460" height="790" rx="18" fill="${body}" stroke="#00000035" stroke-width="3"/>${cells}`);
}
function scene(bg) { let s = `<rect width="1600" height="1000" fill="${bg}"/><rect y="720" width="1600" height="280" fill="#00000012"/>`; for (let k = 0; k < 3; k++) { const x = 260 + k * 420; s += `<rect x="${x}" y="${260 + k * 30}" width="300" height="${500 - k * 30}" rx="16" fill="#faf8f4" stroke="#b4aa9e" stroke-width="3"/>`; for (let r = 0; r < 4; r++) s += `<rect x="${x + 24}" y="${290 + k * 30 + r * 112}" width="252" height="90" rx="8" fill="none" stroke="#bfb4a8" stroke-width="3"/>`; } return svg(1600, 1000, s); }
function svg(w, h, body) { return `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`).toString("base64")}`; }
const SCENES = { "scene-1": "#e8e0d4", "scene-2": "#dce4e0", "scene-3": "#eee6dc" };
const img = n => SCENES[n] ? scene(SCENES[n]) : cabinet(n);
const cats = [
  { id: "c1", name: "Tủ quần áo", slug: "tu-quan-ao", description: "Tủ nhựa nhiều cánh cho phòng ngủ." },
  { id: "c2", name: "Tủ ngăn kéo", slug: "tu-ngan-keo", description: "Ngăn kéo xếp tầng cho đồ lặt vặt." },
  { id: "c3", name: "Tủ giày", slug: "tu-giay", description: "Gọn lối vào nhà." },
  { id: "c4", name: "Kệ bếp", slug: "ke-bep", description: "Kệ để đồ khô và gia vị." },
  { id: "c5", name: "Đồ trẻ em", slug: "do-tre-em", description: "Tủ nhỏ, màu nhẹ cho bé." },
].map((c, i) => ({ ...c, is_visible: true, sort_order: i }));
const initialCats = structuredClone(cats);
// Mirrors the API: categories are soft-deleted (slug stays reserved), public lists skip hidden/deleted ones.
const liveCats = () => cats.filter(c => !c.deleted_at).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
// Mirrors the products_slug_key / products_sku_key unique constraints.
const productClash = (b, id) => products.some(x => x.id !== id && b.slug && x.slug === b.slug) ? "Slug already exists" : products.some(x => x.id !== id && b.sku && x.sku === b.sku) ? "SKU already exists" : null;
const raw = [
  ["Tủ nhựa 5 tầng nắp trắng", "tu-5-tang", "TN-5T-01", "1250000", "in_stock", "c2", { "Kích thước": "48 × 42 × 108 cm", "Chất liệu": "Nhựa PP", "Số ngăn": "5" }],
  ["Tủ áo 3 cánh có gương", "tu-ao-3-canh", "TA-3C-02", "3450000", "in_stock", "c1", { "Kích thước": "120 × 48 × 180 cm" }],
  ["Tủ giày 4 tầng cửa lật", "tu-giay", "TG-4T-03", "890000", "out_of_stock", "c3", {}],
  ["Kệ bếp 3 tầng có bánh xe", "ke-bep", "KB-3T-04", null, "contact", "c4", {}],
  ["Tủ ngăn kéo trẻ em họa tiết gấu Bắc Cực rất dài để thử xuống dòng", "tu-tre-em", "TE-4T-05", "760000", "in_stock", "c5", {}],
  ["Hộp đựng đồ 4 ô", "hop-dung-do", "HD-4O-06", "320000", "in_stock", "c2", {}],
  ["Tủ áo 2 cánh vân gỗ", "tu-ao-2-canh", "TA-2C-07", "2190000", "in_stock", "c1", { "Kích thước": "80 × 48 × 170 cm", "Màu": "Vân gỗ sáng" }],
  ["Tủ 6 ngăn kéo mini", "tu-ngan-keo", "TN-6N-08", "540000", "in_stock", "c2", {}],
];
const products = raw.map(([name, slug, sku, price, stock, cat, attrs], i) => ({
  id: `p${i + 1}`, name, slug, sku, price, stock_status: stock, publish_status: "published", is_visible: true, is_featured: i < 4,
  category_id: cat, category: cats.find(c => c.id === cat), attributes: attrs, published_at: new Date(Date.UTC(2026, 9, 10 - i)).toISOString(),
  description: "Tủ nhựa PP dày, bề mặt nhẵn dễ lau chùi. Các ngăn tháo rời được, lắp ráp không cần dụng cụ.\n\nPhù hợp phòng ngủ, phòng khách hoặc phòng trẻ em.",
  images: [slug, "tu-ngan-keo", "hop-dung-do"].map((n, k) => ({ id: `${slug}-${k}`, storage_key: n, url: img(n), alt_text: k ? `${name} — góc ${k + 1}` : name, sort_order: k, is_primary: k === 0 })),
}));
const posts = [
  ["Cách chọn tủ nhựa cho phòng ngủ nhỏ", "chon-tu-phong-ngu", "scene-1", "Đo khoảng trống, chọn số cánh và chiều cao phù hợp để phòng vẫn thoáng."],
  ["Vệ sinh tủ nhựa đúng cách để bền màu", "ve-sinh-tu-nhua", "scene-2", "Dùng khăn mềm và nước ấm; tránh dung môi mạnh làm mờ bề mặt."],
  ["Sắp xếp góc học tập cho bé với tủ ngăn kéo", "goc-hoc-tap", "scene-3", "Mỗi ngăn một nhóm đồ: sách, bút, đồ chơi — bé tự cất được."],
].map(([title, slug, cover, excerpt], i) => ({ id: `n${i + 1}`, title, slug, excerpt, cover_image_url: img(cover), publish_status: "published",
  published_at: new Date(Date.UTC(2026, 9, 8 - i * 5)).toISOString(), images: [],
  content_html: `<p>${excerpt}</p><h2>Đo đạc trước khi mua</h2><p>Hãy đo chiều rộng, chiều sâu và chiều cao khoảng trống. Chừa ít nhất 5 cm phía sau để tủ không chạm tường ẩm.</p><ul><li>Phòng dưới 10 m²: tủ 2 cánh hoặc tủ ngăn kéo.</li><li>Phòng lớn hơn: tủ 3 cánh có gương.</li></ul><blockquote>Tủ nhựa nhẹ, dễ di chuyển khi cần sắp xếp lại phòng.</blockquote><h3>Màu sắc</h3><p>Màu sáng giúp phòng trông rộng hơn. Vân gỗ hợp với nội thất ấm.</p><p><a href="/san-pham">Xem các mẫu tủ</a></p>` }));
const settings = { store_name: process.env.MOCK_STORE ?? "Tủ Nhựa Bình Nhâm", logo_url: null, favicon_url: null, facebook_url: "https://facebook.com/", messenger_url: "https://m.me/",
  hotline: "0900 000 000", address: "Cập nhật địa chỉ trong CMS", about_text: "Tủ nhựa và đồ lưu trữ cho gia đình.", contact_tracking_enabled: true };
const initialSettings = structuredClone(settings);
const banners = [{ id: "b1", title: "Nhà gọn, mỗi ngày nhẹ nhàng hơn", subtitle: "Tủ nhựa, tủ ngăn kéo và kệ lưu trữ cho từng góc trong nhà.", image_url: img("scene-1"), cta_label: "Xem sản phẩm", cta_url: "/san-pham", is_active: true, sort_order: 0 }];
const page = (items, q) => { const size = Number(q.get("page_size") ?? 20), p = Number(q.get("page") ?? 1); return { items: items.slice((p - 1) * size, p * size), page: p, page_size: size, total: items.length, pages: Math.ceil(items.length / size) }; };
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const user = { id: "00000000-0000-0000-0000-00000000qa01", aud: "authenticated", role: "authenticated", email: "qa@example.test", app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" };
const issued = new Set(); // fake auth only accepts tokens it issued, like real Supabase rejects tampered JWTs
const session = () => { const exp = Math.floor(Date.now() / 1000) + 3600; const access_token = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: user.id, role: "authenticated", aud: "authenticated", email: user.email, exp, jti: crypto.randomUUID() })}.qa`; const refresh_token = crypto.randomUUID(); issued.add(access_token); issued.add(`r:${refresh_token}`); return { access_token, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token, user }; };
products[3].publish_status = "draft"; products[5].is_visible = false;
const initialProducts = structuredClone(products);
const adminPosts = posts.map(p => ({ ...p, seo_title: null, seo_description: null }));
let outage = false; /* POST /__outage?on=1 makes public endpoints return 503 (edge-cache degraded tests) */
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"); const path = u.pathname.replace(/^\/api\/v1/, ""); const q = u.searchParams;
  const send = (code, body) => { res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" }); res.end(code === 204 ? "" : JSON.stringify(body)); };
  if (req.method === "OPTIONS") return send(204, {});
  // ponytail: publish/visibility filtering applies only to spec-created "e2e-" records so fixture screenshots stay stable.
  const isPublic = p => !p.slug.startsWith("e2e-") || (p.publish_status === "published" && p.is_visible && !p.deleted_at);
  if (u.pathname === "/auth/v1/token") { let body = ""; req.on("data", c => body += c); req.on("end", () => { const b = JSON.parse(body || "{}"); if (u.searchParams.get("grant_type") === "refresh_token") return issued.delete(`r:${b.refresh_token}`) ? send(200, session()) : send(400, { error: "invalid_grant", msg: "Invalid Refresh Token", code: "refresh_token_not_found" }); if (b.password !== "qa-password-123") return send(400, { error: "invalid_grant", error_description: "Invalid login credentials", msg: "Invalid login credentials", code: "invalid_credentials" }); send(200, session()); }); return; }
  if (u.pathname === "/auth/v1/user") return issued.has((req.headers.authorization ?? "").replace(/^Bearer /, "")) ? send(200, user) : send(401, { msg: "invalid JWT" });
  if (u.pathname === "/auth/v1/logout") { issued.delete((req.headers.authorization ?? "").replace(/^Bearer /, "")); return send(204, {}); }
  if (u.pathname === "/__outage" && req.method === "POST") { outage = q.get("on") === "1"; return send(200, { outage }); }
  if (outage && !u.pathname.startsWith("/__") && !path.startsWith("/admin")) return send(503, { error: { message: "Simulated outage" } });
  if (u.pathname === "/__reset" && req.method === "POST") { products.splice(0, products.length, ...structuredClone(initialProducts)); cats.splice(0, cats.length, ...structuredClone(initialCats)); Object.assign(settings, structuredClone(initialSettings)); return send(200, { reset: true }); }
  if (path.startsWith("/admin/")) {
    // In-memory writes so UI specs can be dry-run locally (incl. staging-cms.spec.ts with E2E_* pointing here).
    // Settings, posts and banners stay read-only (403) so write-failure feedback remains testable.
    const pw = path.match(/^\/admin\/products\/(.+)$/);
    const readBody = fn => { const chunks = []; req.on("data", c => chunks.push(c)); req.on("end", () => fn(Buffer.concat(chunks))); };
    const withImages = (p, imgs) => imgs.map((im, i) => ({ id: `${p.slug}-${im.storage_key}`, ...im, sort_order: im.sort_order ?? i }));
    if (pw && req.method === "PATCH") return readBody(raw => { const p = products.find(x => x.id === pw[1]); if (!p) return send(404, { error: { message: "Không tìm thấy" } }); const b = JSON.parse(raw.toString() || "{}"); const clash = productClash(b, p.id); if (clash) return send(409, { error: { message: clash } }); if (b.publish_status === "published" && !p.published_at) b.published_at = new Date().toISOString(); const category_id = "category_id" in b ? b.category_id : p.category_id; Object.assign(p, b, { category_id, category: cats.find(c => c.id === category_id) ?? null, images: withImages(p, b.images ?? p.images) }); send(200, p); });
    if (pw && req.method === "DELETE") { const i = products.findIndex(x => x.id === pw[1]); if (i >= 0) products.splice(i, 1); return send(204, {}); }
    if (path === "/admin/products" && req.method === "POST") return readBody(raw => { const b = JSON.parse(raw.toString() || "{}"); const clash = productClash(b); if (clash) return send(409, { error: { message: clash } }); const p = { id: crypto.randomUUID(), is_featured: false, published_at: b.publish_status === "published" ? new Date().toISOString() : null, attributes: {}, ...b, category: cats.find(c => c.id === b.category_id) ?? null }; p.images = withImages(p, b.images ?? []); products.push(p); send(201, p); });
    if (path === "/admin/categories" && req.method === "POST") return readBody(raw => { const c = { id: crypto.randomUUID(), description: null, is_visible: true, sort_order: 0, ...JSON.parse(raw.toString() || "{}") }; if (cats.some(x => x.slug === c.slug)) return send(409, { error: { message: "Slug already exists" } }); cats.push(c); send(201, c); });
    const cd = path.match(/^\/admin\/categories\/(.+)$/); const cat = cd && liveCats().find(c => c.id === cd[1]);
    if (cd && !cat && req.method !== "GET") return send(404, { error: { message: "Category not found" } });
    if (cd && req.method === "PATCH") return readBody(raw => { const b = JSON.parse(raw.toString() || "{}"); if (b.slug && cats.some(x => x !== cat && x.slug === b.slug)) return send(409, { error: { message: "Slug already exists" } }); Object.assign(cat, b); send(200, cat); });
    if (cd && req.method === "DELETE") { if (products.some(p => p.category_id === cat.id)) return send(409, { error: { message: "Category has products" } }); Object.assign(cat, { deleted_at: new Date().toISOString(), is_visible: false }); return send(204, {}); }
    if (path === "/admin/media" && req.method === "POST") return readBody(() => { const key = `${new Date().toISOString().slice(0, 7).replace("-", "/")}/${crypto.randomUUID()}.png`; send(201, { id: crypto.randomUUID(), bucket: q.get("bucket"), storage_key: key, url: svg(10, 10, `<!-- ${key} --><rect width="10" height="10" fill="#d8c9b6"/>`) }); });
    if (path.startsWith("/admin/media") && req.method === "DELETE") return send(204, {});
    const collection = path.match(/^\/admin\/(posts|banners)(?:\/([^/]+))?$/);
    if (collection && req.method !== "GET") {
      const list = collection[1] === "posts" ? adminPosts : banners; const id = collection[2];
      if (req.method === "DELETE") { const i = list.findIndex(x => x.id === id); if (i >= 0) list.splice(i, 1); return send(204, {}); }
      return readBody(raw => { const b = JSON.parse(raw.toString() || "{}");
        if (req.method === "POST") { const item = { id: crypto.randomUUID(), images: [], published_at: new Date().toISOString(), is_active: true, sort_order: 0, ...b }; list.push(item); if (list === adminPosts) posts.push(item); return send(201, item); }
        const item = list.find(x => x.id === id); if (!item) return send(404, { error: { message: "Không tìm thấy" } }); Object.assign(item, b); return send(200, item); });
    }
    if (path === "/admin/site-settings" && req.method === "PATCH" && process.env.MOCK_WRITABLE_SETTINGS === "1") return readBody(raw => { Object.assign(settings, JSON.parse(raw.toString() || "{}")); send(200, settings); });
    if (req.method !== "GET") return send(403, { error: { message: "QA mock: thao tác ghi bị tắt trong môi trường kiểm thử giao diện" } });
    const a = path.slice(6);
    if (a === "/dashboard/stats") return send(200, { products: products.length, categories: cats.length, posts: posts.length, visible_products: products.filter(p => p.is_visible).length, contact_clicks: 0 });
    if (a === "/products") { /* mirrors repositories/catalog.py: admin search matches name only */ const t = q.get("search")?.toLowerCase(); return send(200, page(t ? products.filter(p => p.name.toLowerCase().includes(t)) : products, q)); }
    const pm = a.match(/^\/products\/(.+)$/); if (pm) { const p = products.find(x => x.id === pm[1]); return p ? send(200, p) : send(404, { error: { message: "Không tìm thấy" } }); }
    if (a === "/categories") return send(200, liveCats().map(c => ({ ...c, product_count: products.filter(p => p.category_id === c.id).length })));
    if (a === "/posts") return send(200, adminPosts);
    if (a === "/banners") return send(200, banners);
    if (a === "/site-settings") return send(200, settings);
    return send(404, { error: { message: "not found" } });
  }
  if (req.method === "POST" && path === "/contact-clicks") return send(201, {});
  if (process.env.MOCK_EMPTY) { if (path === "/site-settings") return send(200, settings); return send(200, path.startsWith("/products/") || path.startsWith("/posts/") ? null : (path === "/categories" || path === "/banners" ? [] : { items: [], page: 1, page_size: 20, total: 0, pages: 0 })); }
  if (path === "/products") { let list = products.filter(isPublic); const s = q.get("search")?.toLowerCase(); if (s) list = list.filter(p => p.name.toLowerCase().includes(s)); const c = q.get("category"); if (c) list = list.filter(p => p.category?.slug === c && !p.category.deleted_at);
    const sort = q.get("sort"); if (sort === "price") list = [...list].sort((a, b) => Number(a.price ?? 1e12) - Number(b.price ?? 1e12)); if (sort === "-price") list = [...list].sort((a, b) => Number(b.price ?? 0) - Number(a.price ?? 0)); return send(200, page(list, q)); }
  const m = path.match(/^\/(products|posts)\/(.+)$/); if (m) { const item = (m[1] === "products" ? products.filter(isPublic) : posts).find(x => x.slug === m[2]); return item ? send(200, item) : send(404, { error: { message: "Không tìm thấy" } }); }
  if (path === "/categories") return send(200, liveCats().filter(c => c.is_visible));
  if (path === "/posts") return send(200, page(posts, q));
  if (path === "/banners") return send(200, banners.filter(b => b.is_active).sort((x, y) => x.sort_order - y.sort_order));
  if (path === "/site-settings") return send(200, settings);
  send(404, { error: { message: "not found" } });
}).listen(Number(process.env.PORT ?? 8100), "127.0.0.1", () => console.log(`QA mock API on http://127.0.0.1:${process.env.PORT ?? 8100}`));
