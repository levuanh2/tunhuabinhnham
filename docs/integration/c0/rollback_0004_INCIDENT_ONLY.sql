-- INCIDENT-ONLY manual rollback for migration 0004 (security hardening).
-- NOT executed by anyone. Generated from the read-only ACL snapshot in inventory_pre_c1.json (2026-10-11, revision 0003).
-- WARNING: running this REOPENS full anon/authenticated write privileges on every public table
-- (and anon access to alembic_version). Prefer fixing forward. Requires explicit owner incident approval.
-- Run with: PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s'

begin;

alter table public.alembic_version disable row level security;

grant select, insert, update, delete, truncate, references, trigger on table
  public.alembic_version,
  public.admin_users, public.audit_logs, public.contact_clicks, public.media_assets,
  public.categories, public.products, public.product_images, public.posts,
  public.post_images, public.banners, public.site_settings
to anon, authenticated;

-- Pre-0004 state: prosecdef=false (already invoker), proconfig=null, EXECUTE granted to PUBLIC, anon, authenticated.
alter function public.set_updated_at() reset search_path;
grant execute on function public.set_updated_at() to public, anon, authenticated;

-- Pre-0004 default ACLs for objects created by role postgres in schema public.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete, truncate, references, trigger, maintain on tables to anon, authenticated;
alter default privileges for role postgres in schema public
  grant execute on functions to public, anon, authenticated;

update public.alembic_version set version_num = '0003' where version_num = '0004';

commit;
