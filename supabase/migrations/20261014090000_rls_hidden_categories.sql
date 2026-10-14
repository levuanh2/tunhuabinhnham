-- V1-SEC-03: products and images in a hidden or deleted category are not public through the
-- Data API, matching FastAPI's public_product_conditions. Policy names, roles and grants are
-- unchanged. No transaction statements: Alembic owns the transaction.
alter policy "public read published products" on public.products using (
  publish_status = 'published' and is_visible and deleted_at is null
  and (published_at is null or published_at <= now())
  and (category_id is null or exists (select 1 from public.categories c
    where c.id = products.category_id and c.is_visible and c.deleted_at is null))
);
alter policy "public read product images" on public.product_images using (
  exists (select 1 from public.products p where p.id = product_id
    and p.publish_status = 'published' and p.is_visible and p.deleted_at is null
    and (p.published_at is null or p.published_at <= now())
    and (p.category_id is null or exists (select 1 from public.categories c
      where c.id = p.category_id and c.is_visible and c.deleted_at is null)))
);
