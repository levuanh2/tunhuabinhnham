-- Least-privilege hardening for the public Data API schema.
-- Non-destructive: no rows or application objects are removed.

-- Alembic's revision table is operational metadata, not a public API.
alter table public.alembic_version enable row level security;
revoke all privileges on table public.alembic_version from anon, authenticated;

-- Internal tables are accessed only by the trusted FastAPI database connection.
revoke all privileges on table
  public.admin_users,
  public.audit_logs,
  public.contact_clicks,
  public.media_assets
from anon, authenticated;

-- Public catalogue tables are read-only through PostgREST. RLS still filters rows.
revoke all privileges on table
  public.categories,
  public.products,
  public.product_images,
  public.posts,
  public.post_images,
  public.banners,
  public.site_settings
from anon, authenticated;

grant select on table
  public.categories,
  public.products,
  public.product_images,
  public.posts,
  public.post_images,
  public.banners,
  public.site_settings
to anon, authenticated;

-- The trigger function is invoker-safe, resolves no attacker-controlled schema,
-- and cannot be invoked directly through the Data API roles.
alter function public.set_updated_at() security invoker;
alter function public.set_updated_at() set search_path = '';
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- New public-schema objects start private; later migrations must grant deliberately.
alter default privileges in schema public
  revoke all privileges on tables from anon, authenticated;
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;
