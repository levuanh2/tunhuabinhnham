-- V1.1: every slug a product has had since it was public, so an old product URL keeps
-- redirecting to the current one. A slug, current or old, belongs to one product forever
-- (unique key). The API writes these rows in the same transaction as the product change.
-- No transaction statements: Alembic owns the transaction. Product rows are only read.
-- Give up instead of queueing behind long product writes (the FK and trigger need a lock on
-- products); a timeout rolls everything back and the migration can simply be rerun.
set local lock_timeout = '5s';

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

-- The ownership rule also holds for writers that do not know product_slugs, such as an older
-- backend after a rollback: a product cannot take a slug that another product has had.
-- Reported as products_slug_key so every backend version maps it to "Slug already exists".
create function public.product_slug_not_owned_elsewhere() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1 from public.product_slugs s where s.slug = new.slug and s.product_id <> new.id
  ) then
    raise exception 'slug belongs to another product'
      using errcode = 'unique_violation', constraint = 'products_slug_key';
  end if;
  return new;
end
$$;
revoke all on function public.product_slug_not_owned_elsewhere() from public, anon, authenticated;
create trigger product_slug_not_owned_elsewhere
before insert or update of slug on public.products
for each row execute function public.product_slug_not_owned_elsewhere();
