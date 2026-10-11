-- PRODUCT SHOWCASE + ADMIN CMS | Supabase PostgreSQL
-- Run in: Supabase Dashboard -> SQL Editor (using postgres role)
-- This is an INITIAL migration for a NEW project; do not run against
-- existing tables with the same names without reviewing schema differences.
-- Safe to re-run only when the schema has not been modified independently.

begin;

-- 1. Admin membership (accounts live in Supabase Auth, auth.users)
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'editor')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Categories (including optional nested categories)
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.categories(id) on delete set null,
  name text not null,
  slug text not null unique,
  description text,
  image_path text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint category_slug_valid check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint category_parent_not_self check (parent_id is distinct from id)
);

-- 3. Products (NULL price = 'Liên hệ')
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  slug text not null unique,
  sku text unique,
  summary text,
  description_html text not null default '',
  price numeric(14, 2),
  compare_at_price numeric(14, 2),
  currency text not null default 'VND',
  stock_status text not null default 'available'
    check (stock_status in ('available', 'out_of_stock', 'contact')),
  attributes jsonb not null default '{}'::jsonb,
  is_featured boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  seo_title text,
  seo_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint product_slug_valid check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint product_price_nonnegative check (price is null or price >= 0),
  constraint product_compare_price_nonnegative check (
    compare_at_price is null or compare_at_price >= 0
  )
);

-- 4. Product photos; storage_path points to the Supabase Storage object key
create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_path text not null,
  alt_text text,
  is_primary boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, storage_path)
);
create unique index if not exists uq_product_primary_image
  on public.product_images (product_id) where is_primary = true;

-- 5. News/blog posts
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references auth.users(id) on delete set null,
  title text not null,
  slug text not null unique,
  excerpt text,
  content_html text not null default '',
  cover_image_path text,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  is_featured boolean not null default false,
  published_at timestamptz,
  seo_title text,
  seo_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint post_slug_valid check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

create table if not exists public.post_images (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  storage_path text not null,
  alt_text text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, storage_path)
);

-- 6. Homepage banners
create table if not exists public.banners (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text,
  image_path text not null,
  button_text text,
  button_url text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint banner_date_order check (
    starts_at is null or ends_at is null or ends_at > starts_at
  )
);

-- 7. Singleton settings: public store information only (NO SECRETS)
create table if not exists public.site_settings (
  id smallint primary key default 1 check (id = 1),
  store_name text not null default 'Cửa hàng của tôi',
  store_description text,
  logo_path text,
  favicon_path text,
  facebook_page_url text,
  messenger_url text,
  hotline text,
  address text,
  seo_title text,
  seo_description text,
  updated_at timestamptz not null default now()
);
insert into public.site_settings (id, store_name)
values (1, 'Cửa hàng của tôi')
on conflict (id) do nothing;

-- 8. Events and audits are SERVER-WRITE ONLY, never writable by anon clients
create table if not exists public.contact_clicks (
  id bigint generated always as identity primary key,
  product_id uuid references public.products(id) on delete set null,
  source text not null default 'product'
    check (source in ('product', 'homepage', 'contact', 'banner')),
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 9. Indexes for page lists and filters
create index if not exists idx_categories_parent on public.categories(parent_id);
create index if not exists idx_categories_active_sort
  on public.categories(sort_order, created_at desc)
  where is_active = true and deleted_at is null;
create index if not exists idx_products_category on public.products(category_id);
create index if not exists idx_products_visible
  on public.products(published_at desc, created_at desc)
  where status = 'published' and deleted_at is null;
create index if not exists idx_products_featured
  on public.products(created_at desc)
  where is_featured = true and status = 'published' and deleted_at is null;
create index if not exists idx_products_price on public.products(price)
  where deleted_at is null;
create index if not exists idx_product_images_order
  on public.product_images(product_id, sort_order);
create index if not exists idx_posts_visible
  on public.posts(published_at desc, created_at desc)
  where status = 'published' and deleted_at is null;
create index if not exists idx_post_images_order
  on public.post_images(post_id, sort_order);
create index if not exists idx_banners_active_sort
  on public.banners(sort_order)
  where is_active = true and deleted_at is null;
create index if not exists idx_contact_clicks_created
  on public.contact_clicks(created_at desc);

-- 10. Automatically refresh updated_at on updates
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function public.set_updated_at() from public, anon, authenticated;

do $$
declare tbl text;
begin
  foreach tbl in array array[
    'admin_users', 'categories', 'products', 'product_images',
    'posts', 'post_images', 'banners', 'site_settings'
  ] loop
    execute format('drop trigger if exists trg_updated_at on public.%I', tbl);
    execute format(
      'create trigger trg_updated_at before update on public.%I '
      || 'for each row execute function public.set_updated_at()', tbl
    );
  end loop;
end;
$$;

-- 11. Role helper is NOT exposed as a public RPC function
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users au
    where au.user_id = (select auth.uid())
      and au.role = 'admin'
      and au.is_active = true
  );
$$;
revoke all on function private.is_admin() from public, anon, authenticated;
grant execute on function private.is_admin() to authenticated;

-- 12. RLS on ALL public tables
alter table public.admin_users enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.posts enable row level security;
alter table public.post_images enable row level security;
alter table public.banners enable row level security;
alter table public.site_settings enable row level security;
alter table public.contact_clicks enable row level security;
alter table public.audit_logs enable row level security;

-- Deny default client access and grant only needed privileges.
revoke all on public.admin_users, public.categories, public.products,
  public.product_images, public.posts, public.post_images, public.banners,
  public.site_settings, public.contact_clicks, public.audit_logs
  from anon, authenticated;

grant select on public.categories, public.products, public.product_images,
  public.posts, public.post_images, public.banners, public.site_settings
  to anon, authenticated;
grant select, insert, update, delete on public.categories, public.products,
  public.product_images, public.posts, public.post_images, public.banners
  to authenticated;
grant update on public.site_settings to authenticated;
grant select on public.admin_users, public.audit_logs to authenticated;
-- Important: neither anon nor authenticated can write contact_clicks/audit_logs.

-- Public reads see only explicitly published/active content.
drop policy if exists public_categories on public.categories;
create policy public_categories on public.categories for select to anon, authenticated
using (is_active = true and deleted_at is null);

drop policy if exists public_products on public.products;
create policy public_products on public.products for select to anon, authenticated
using (
  status = 'published' and deleted_at is null
  and (published_at is null or published_at <= now())
);

drop policy if exists public_product_images on public.product_images;
create policy public_product_images on public.product_images for select to anon, authenticated
using (
  exists (
    select 1 from public.products p
    where p.id = product_id
      and p.status = 'published' and p.deleted_at is null
      and (p.published_at is null or p.published_at <= now())
  )
);

drop policy if exists public_posts on public.posts;
create policy public_posts on public.posts for select to anon, authenticated
using (
  status = 'published' and deleted_at is null
  and (published_at is null or published_at <= now())
);

drop policy if exists public_post_images on public.post_images;
create policy public_post_images on public.post_images for select to anon, authenticated
using (
  exists (
    select 1 from public.posts p
    where p.id = post_id
      and p.status = 'published' and p.deleted_at is null
      and (p.published_at is null or p.published_at <= now())
  )
);

drop policy if exists public_banners on public.banners;
create policy public_banners on public.banners for select to anon, authenticated
using (
  is_active = true and deleted_at is null
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
);

drop policy if exists public_site_settings on public.site_settings;
create policy public_site_settings on public.site_settings for select to anon, authenticated
using (id = 1);

-- Allow each admin account to read its OWN role record.
drop policy if exists admin_read_own_role on public.admin_users;
create policy admin_read_own_role on public.admin_users
for select to authenticated using (user_id = (select auth.uid()));

-- Content CRUD policies: only admin accounts can modify content.
-- A single loop avoids divergent permission rules across content tables.
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'categories', 'products', 'product_images',
    'posts', 'post_images', 'banners'
  ] loop
    execute format('drop policy if exists %I on public.%I', 'admin_select_' || tbl, tbl);
    execute format(
      'create policy %I on public.%I for select to authenticated '
      || 'using ((select private.is_admin()))', 'admin_select_' || tbl, tbl
    );
    execute format('drop policy if exists %I on public.%I', 'admin_insert_' || tbl, tbl);
    execute format(
      'create policy %I on public.%I for insert to authenticated '
      || 'with check ((select private.is_admin()))', 'admin_insert_' || tbl, tbl
    );
    execute format('drop policy if exists %I on public.%I', 'admin_update_' || tbl, tbl);
    execute format(
      'create policy %I on public.%I for update to authenticated '
      || 'using ((select private.is_admin())) '
      || 'with check ((select private.is_admin()))', 'admin_update_' || tbl, tbl
    );
    execute format('drop policy if exists %I on public.%I', 'admin_delete_' || tbl, tbl);
    execute format(
      'create policy %I on public.%I for delete to authenticated '
      || 'using ((select private.is_admin()))', 'admin_delete_' || tbl, tbl
    );
  end loop;
end;
$$;

drop policy if exists admin_update_settings on public.site_settings;
create policy admin_update_settings on public.site_settings
for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

drop policy if exists admin_read_audit_logs on public.audit_logs;
create policy admin_read_audit_logs on public.audit_logs
for select to authenticated using ((select private.is_admin()));

-- 13. Image bucket. Public object URLs are accessible to anyone who knows URL.
-- Store only non-sensitive, publishable assets here.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'showcase-media', 'showcase-media', true, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']::text[]
)
on conflict (id) do nothing;

-- Admin-only object operations through Supabase Storage API.
drop policy if exists showcase_admin_storage_select on storage.objects;
create policy showcase_admin_storage_select on storage.objects
for select to authenticated
using (bucket_id = 'showcase-media' and (select private.is_admin()));

drop policy if exists showcase_admin_storage_insert on storage.objects;
create policy showcase_admin_storage_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'showcase-media' and (select private.is_admin()));

drop policy if exists showcase_admin_storage_update on storage.objects;
create policy showcase_admin_storage_update on storage.objects
for update to authenticated
using (bucket_id = 'showcase-media' and (select private.is_admin()))
with check (bucket_id = 'showcase-media' and (select private.is_admin()));

drop policy if exists showcase_admin_storage_delete on storage.objects;
create policy showcase_admin_storage_delete on storage.objects
for delete to authenticated
using (bucket_id = 'showcase-media' and (select private.is_admin()));

commit;

-- Check created tables:
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'admin_users', 'categories', 'products', 'product_images',
    'posts', 'post_images', 'banners', 'site_settings',
    'contact_clicks', 'audit_logs'
  )
order by table_name;
