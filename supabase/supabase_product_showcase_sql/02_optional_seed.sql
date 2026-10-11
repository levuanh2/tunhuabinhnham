-- OPTIONAL DEV SAMPLE DATA -- run AFTER 01_schema.sql
-- All sample products/posts are DRAFT, so they will not appear on the public website.
-- Do NOT execute if you want a completely empty catalog.

insert into public.categories (name, slug, description, sort_order)
values
  ('Sản phẩm', 'san-pham', 'Danh mục sản phẩm mẫu', 1),
  ('Phụ kiện', 'phu-kien', 'Danh mục phụ kiện mẫu', 2),
  ('Khác', 'khac', 'Danh mục khác', 3)
on conflict (slug) do nothing;

insert into public.products (
  category_id, name, slug, sku, summary, price, stock_status,
  status, attributes
)
select
  c.id, 'Sản phẩm mẫu 01', 'san-pham-mau-01', 'DEMO-001',
  'Sản phẩm demo để kiểm thử CMS; chưa phải hàng thật.',
  250000, 'available', 'draft', '{"mau_sac":"Tùy chọn"}'::jsonb
from public.categories c where c.slug = 'san-pham'
on conflict (slug) do nothing;

insert into public.posts (title, slug, excerpt, content_html, status)
values (
  'Bài viết mẫu', 'bai-viet-mau',
  'Nội dung dùng để kiểm tra trang quản trị.',
  '<p>Hãy thay thế nội dung này bằng bài viết thật.</p>', 'draft'
)
on conflict (slug) do nothing;

select 'categories' as entity, count(*) as total from public.categories
union all select 'products', count(*) from public.products
union all select 'posts', count(*) from public.posts;
