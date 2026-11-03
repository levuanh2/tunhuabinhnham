// Read-only API compatibility check against the production backend (GETs + unauthenticated admin GETs only).
// Usage: node api-check.mjs <api origin> <site origin> <label> > out.json
const [api, site, label] = process.argv.slice(2);
const get = async (path, headers = {}) => {
  for (let i = 0; i < 3; i++) try {
    const t = Date.now(); const r = await fetch(api + path, { headers, redirect: "manual", signal: AbortSignal.timeout(60000) });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, ms: Date.now() - t, json, headers: Object.fromEntries(r.headers) };
  } catch (e) { if (i === 2) return { status: "network", error: e?.cause?.code ?? e?.name }; }
};
const list = await get("/api/v1/products?page_size=50");
const products = list.json?.items ?? [];
const withCategory = products.find(p => p.category && products.filter(q => q.category?.slug === p.category.slug).length > 1) ?? products[0];
const slug = withCategory?.slug;
const plain = await get(`/api/v1/products/${slug}`, { origin: site });
const related = await get(`/api/v1/products/${slug}?related=4`, { origin: site });
const expected = products.filter(p => p.id !== withCategory.id && (!withCategory.category || p.category?.slug === withCategory.category.slug)).map(p => p.slug);
const out = {
  label, at: new Date().toISOString(), api,
  health: { live: (await get("/health/live")).status, ready: (await get("/health/ready")).status },
  slug, publicProducts: products.length,
  plain: { status: plain.status, ms: plain.ms, keys: Object.keys(plain.json ?? {}).sort(), related: plain.json?.related, acao: plain.headers?.["access-control-allow-origin"] ?? null, cc: plain.headers?.["cache-control"] },
  withRelated: { status: related.status, ms: related.ms, slug: related.json?.slug, related: related.json?.related?.map(p => p.slug) ?? null,
    relatedOk: Array.isArray(related.json?.related) ? related.json.related.length <= 4 && related.json.related.every(p => expected.includes(p.slug)) && related.json.related.length === Math.min(4, expected.length) : null, expectedCandidates: expected.length },
  over: (await get(`/api/v1/products/${slug}?related=13`)).status,
  unknown: (await get("/api/v1/products/khong-ton-tai-zz9?related=4")).status,
  lists: { products: list.status, categories: (await get("/api/v1/categories")).status, posts: (await get("/api/v1/posts")).status, settings: (await get("/api/v1/site-settings")).status },
  adminWithoutToken: { products: (await get("/api/v1/admin/products")).status, stats: (await get("/api/v1/admin/dashboard/stats")).status },
};
console.log(JSON.stringify(out, null, 1));
