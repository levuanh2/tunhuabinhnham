-- V1.1: every slug a product has had since it was public, so an old product URL keeps
-- redirecting to the current one. A slug, current or old, belongs to one product forever
-- (unique key). The API writes these rows in the same transaction as the product change.
-- No transaction statements: Alembic owns the transaction. Product rows are only read.
create table public.product_slugs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  slug varchar(260) not null unique,
  created_at timestamptz not null default now()
);
create index ix_product_slugs_product_id on public.product_slugs(product_id);

-- Internal table: no Data API access (the public site reads products through FastAPI).
alter table public.product_slugs enable row level security;
revoke all privileges on table public.product_slugs from anon, authenticated;

-- Every existing product keeps its current slug, soft-deleted ones included.
insert into public.product_slugs (product_id, slug, created_at)
select id, slug, created_at from public.products;
