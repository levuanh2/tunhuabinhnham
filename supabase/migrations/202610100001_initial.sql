create extension if not exists pgcrypto;

do $$ begin create type stock_status as enum ('in_stock','out_of_stock','contact'); exception when duplicate_object then null; end $$;
do $$ begin create type publish_status as enum ('draft','published'); exception when duplicate_object then null; end $$;
do $$ begin create type post_publish_status as enum ('draft','published'); exception when duplicate_object then null; end $$;

create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(), auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  email varchar(320) not null unique, role varchar(30) not null default 'admin' check (role in ('admin','editor')),
  is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists ix_admin_users_auth_user_id on public.admin_users(auth_user_id);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(), name varchar(160) not null, slug varchar(180) not null unique,
  description text, image_url text, is_visible boolean not null default true, sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create index if not exists ix_categories_slug on public.categories(slug);
create index if not exists ix_categories_visible on public.categories(is_visible) where deleted_at is null;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(), category_id uuid references public.categories(id) on delete set null,
  name varchar(240) not null, slug varchar(260) not null unique, sku varchar(80) not null unique, description text,
  price numeric(14,2) check (price is null or price >= 0), stock_status stock_status not null default 'contact',
  publish_status publish_status not null default 'draft', is_visible boolean not null default true, is_featured boolean not null default false,
  attributes jsonb not null default '{}'::jsonb, published_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create index if not exists ix_products_name_search on public.products using gin(to_tsvector('simple', name));
create index if not exists ix_products_public on public.products(publish_status,is_visible,deleted_at,published_at);
create index if not exists ix_products_category on public.products(category_id);

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products(id) on delete cascade,
  storage_key text not null unique, url text not null, alt_text varchar(300), sort_order integer not null default 0 check (sort_order >= 0),
  is_primary boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(product_id, sort_order)
);
create unique index if not exists uq_product_primary_image on public.product_images(product_id) where is_primary;

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(), title varchar(260) not null, slug varchar(280) not null unique, excerpt text,
  content_json jsonb not null default '{}'::jsonb, content_html text not null default '', cover_image_url text,
  publish_status post_publish_status not null default 'draft', published_at timestamptz, seo_title varchar(260), seo_description varchar(320),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create index if not exists ix_posts_public on public.posts(publish_status,deleted_at,published_at);

create table if not exists public.banners (
  id uuid primary key default gen_random_uuid(), title varchar(240) not null, subtitle text, image_url text not null,
  cta_label varchar(80), cta_url text, is_active boolean not null default true, sort_order integer not null default 0 check(sort_order >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create index if not exists ix_banners_active on public.banners(is_active,sort_order) where deleted_at is null;

create table if not exists public.site_settings (
  id uuid primary key default gen_random_uuid(), store_name varchar(200) not null default 'Tủ Hòa Bình Nhâm', logo_url text, favicon_url text,
  facebook_url text not null default 'https://facebook.com', messenger_url text, hotline varchar(50), address text, about_text text not null default '',
  default_seo_title varchar(260), default_seo_description varchar(320), contact_tracking_enabled boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.contact_clicks (
  id uuid primary key default gen_random_uuid(), product_id uuid references public.products(id) on delete set null,
  source varchar(80) not null default 'unknown', ip_hash varchar(64), user_agent varchar(500), created_at timestamptz not null default now()
);
create index if not exists ix_contact_clicks_created on public.contact_clicks(created_at);

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(), storage_key text not null unique, bucket varchar(80) not null, public_url text not null,
  mime_type varchar(100) not null, size_bytes integer not null check(size_bytes > 0), uploaded_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(), admin_user_id uuid references public.admin_users(id) on delete set null,
  action varchar(80) not null, entity_type varchar(80) not null, entity_id uuid, changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ix_audit_entity on public.audit_logs(entity_type,entity_id,created_at);

drop trigger if exists trg_admin_users_updated on public.admin_users; create trigger trg_admin_users_updated before update on public.admin_users for each row execute function public.set_updated_at();
drop trigger if exists trg_categories_updated on public.categories; create trigger trg_categories_updated before update on public.categories for each row execute function public.set_updated_at();
drop trigger if exists trg_products_updated on public.products; create trigger trg_products_updated before update on public.products for each row execute function public.set_updated_at();
drop trigger if exists trg_product_images_updated on public.product_images; create trigger trg_product_images_updated before update on public.product_images for each row execute function public.set_updated_at();
drop trigger if exists trg_posts_updated on public.posts; create trigger trg_posts_updated before update on public.posts for each row execute function public.set_updated_at();
drop trigger if exists trg_banners_updated on public.banners; create trigger trg_banners_updated before update on public.banners for each row execute function public.set_updated_at();
drop trigger if exists trg_site_settings_updated on public.site_settings; create trigger trg_site_settings_updated before update on public.site_settings for each row execute function public.set_updated_at();
drop trigger if exists trg_media_assets_updated on public.media_assets; create trigger trg_media_assets_updated before update on public.media_assets for each row execute function public.set_updated_at();

alter table public.admin_users enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.posts enable row level security;
alter table public.banners enable row level security;
alter table public.site_settings enable row level security;
alter table public.contact_clicks enable row level security;
alter table public.media_assets enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "public read visible categories" on public.categories;
create policy "public read visible categories" on public.categories for select to anon, authenticated using (is_visible and deleted_at is null);
drop policy if exists "public read published products" on public.products;
create policy "public read published products" on public.products for select to anon, authenticated using (publish_status = 'published' and is_visible and deleted_at is null and (published_at is null or published_at <= now()));
drop policy if exists "public read product images" on public.product_images;
create policy "public read product images" on public.product_images for select to anon, authenticated using (exists(select 1 from public.products p where p.id = product_id and p.publish_status = 'published' and p.is_visible and p.deleted_at is null));
drop policy if exists "public read published posts" on public.posts;
create policy "public read published posts" on public.posts for select to anon, authenticated using (publish_status = 'published' and deleted_at is null and (published_at is null or published_at <= now()));
drop policy if exists "public read active banners" on public.banners;
create policy "public read active banners" on public.banners for select to anon, authenticated using (is_active and deleted_at is null);
drop policy if exists "public read site settings" on public.site_settings;
create policy "public read site settings" on public.site_settings for select to anon, authenticated using (true);

-- Data API access is explicit. RLS still decides which rows are visible.
grant usage on schema public to anon, authenticated;
grant select on public.categories, public.products, public.product_images,
  public.posts, public.banners, public.site_settings to anon, authenticated;

-- Published assets are public; object mutations are performed only by the
-- authenticated FastAPI flow using a server-side service role key.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('product-images', 'product-images', true, 8388608, array['image/jpeg', 'image/png', 'image/webp']::text[]),
  ('post-images', 'post-images', true, 8388608, array['image/jpeg', 'image/png', 'image/webp']::text[]),
  ('banners', 'banners', true, 8388608, array['image/jpeg', 'image/png', 'image/webp']::text[]),
  ('branding', 'branding', true, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/x-icon']::text[])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
