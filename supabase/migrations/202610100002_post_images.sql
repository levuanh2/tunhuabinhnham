-- Incremental, non-destructive support for multiple images per article.
create table if not exists public.post_images (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  storage_key text not null unique,
  url text not null,
  alt_text varchar(300),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(post_id, sort_order)
);

create index if not exists ix_post_images_post_id on public.post_images(post_id);

drop trigger if exists trg_post_images_updated on public.post_images;
create trigger trg_post_images_updated
before update on public.post_images
for each row execute function public.set_updated_at();

alter table public.post_images enable row level security;

drop policy if exists "public read published post images" on public.post_images;
create policy "public read published post images"
on public.post_images for select to anon, authenticated
using (
  exists (
    select 1 from public.posts p
    where p.id = post_id
      and p.publish_status = 'published'
      and p.deleted_at is null
      and (p.published_at is null or p.published_at <= now())
  )
);

grant select on public.post_images to anon, authenticated;
