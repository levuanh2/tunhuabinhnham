-- V1.1: every slug a product has had, so an old product URL keeps redirecting to the current
-- one. A slug, current or old, belongs to one product forever (unique key). The trigger below
-- records them in the same transaction as the product change, whoever the writer is.
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

-- Every writer, including an older backend after a rollback or direct SQL, records the old and
-- the new slug here, and cannot take a slug another product has had. The unique key makes the
-- claim atomic: a concurrent claim of the same slug waits for the other transaction, then
-- either finds it taken (refused) or free (claimed). AFTER, so the new product row exists for
-- the foreign key. Reported as products_slug_key so every backend version answers its usual 409.
create function public.record_product_slug() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    insert into public.product_slugs (product_id, slug) values (old.id, old.slug)
    on conflict (slug) do nothing;
  end if;
  insert into public.product_slugs (product_id, slug) values (new.id, new.slug)
  on conflict (slug) do nothing;
  if exists (
    select 1 from public.product_slugs s where s.slug = new.slug and s.product_id <> new.id
  ) then
    raise exception 'slug belongs to another product'
      using errcode = 'unique_violation', constraint = 'products_slug_key';
  end if;
  return null;
end
$$;
revoke all on function public.record_product_slug() from public, anon, authenticated;
create trigger record_product_slug
after insert or update of slug on public.products
for each row execute function public.record_product_slug();
