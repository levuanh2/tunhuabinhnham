"""Gate C0 read-only inventory. Opens a READ ONLY transaction; prints no secrets."""
import hashlib, json, re, sys
from pathlib import Path
import psycopg

env = dict(l.split("=", 1) for l in Path(r"E:\Tunhuabinhnham\apps\api\.env").read_text(encoding="utf-8").splitlines() if "=" in l and not l.startswith("#"))
url = re.sub(r"^postgresql\+psycopg://", "postgresql://", env["DATABASE_URL"].strip())
ref = re.search(r"postgres\.([a-z0-9]+):", url).group(1)
out = {"project_ref": ref, "ref_fingerprint": hashlib.sha256(ref.encode()).hexdigest()[:12],
       "supabase_url_ref_matches": ref in env.get("SUPABASE_URL", ""), "app_env": env.get("APP_ENV")}
T = ["admin_users", "categories", "products", "product_images", "posts", "post_images", "banners", "site_settings", "media_assets", "contact_clicks", "audit_logs"]
with psycopg.connect(url, connect_timeout=15, options="-c default_transaction_read_only=on -c statement_timeout=15000") as c:
    c.read_only = True
    q = lambda s, *a: c.execute(s, a).fetchall()
    out["server"] = q("select current_database(), current_user, split_part(version(), ' on ', 1), current_setting('transaction_read_only')")[0]
    out["alembic_version"] = q("select version_num from public.alembic_version")
    out["counts"] = {t: q(f"select count(*) from public.{t}")[0][0] for t in T}
    out["e2e_residue"] = {t: q(f"select count(*) from public.{t} where row_to_json({t})::text ilike '%%__e2e_%%'")[0][0] for t in T}
    out["auth_users"] = q("select count(*), count(*) filter (where email ilike '%%e2e%%') from auth.users")[0]
    out["buckets"] = q("select b.id, b.public, b.file_size_limit, coalesce(array_length(b.allowed_mime_types,1),0), (select count(*) from storage.objects o where o.bucket_id=b.id) from storage.buckets b order by b.id")
    out["site_settings"] = q("select store_name, (logo_url is not null), (favicon_url is not null), updated_at::text from public.site_settings")
    out["grants_anon_auth"] = q("select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') group by 1,2 order by 1,2")
    out["rls"] = q("select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r' order by 1")
    out["fn_set_updated_at"] = q("select prosecdef, proconfig, proacl::text from pg_proc where proname='set_updated_at' and pronamespace='public'::regnamespace")
    out["default_acl"] = q("select defaclrole::regrole::text, defaclobjtype, defaclacl::text from pg_default_acl where defaclnamespace='public'::regnamespace")
    out["policies_ref_admin_users"] = q("select schemaname, tablename, policyname, roles::text from pg_policies where coalesce(qual,'')||coalesce(with_check,'') ilike '%%admin_users%%'")
    out["storage_policies"] = q("select policyname, cmd, roles::text from pg_policies where schemaname='storage' and tablename='objects' order by 1")
    out["table_sizes_kb"] = q("select relname, pg_total_relation_size(oid)/1024 from pg_class where relnamespace='public'::regnamespace and relkind='r' order by 1")
    out["activity"] = q("select count(*), count(*) filter (where state <> 'idle'), max(now()-xact_start)::text from pg_stat_activity where datname=current_database()")
    out["pg_dump_needs"] = q("select setting from pg_settings where name='server_version'")
Path(sys.argv[1]).write_text(json.dumps(out, default=str, ensure_ascii=False, indent=1), encoding="utf-8")
