import os

import pytest
from sqlalchemy import create_engine, text

from app.core.config import get_settings


@pytest.mark.integration_supabase
def test_real_supabase_schema_and_rls() -> None:
    """Read-only integration check; requires apps/api/.env with a real DATABASE_URL."""
    if os.getenv("RUN_SUPABASE_INTEGRATION") != "true":
        pytest.skip("BLOCKED_EXTERNAL_CONFIGURATION: set RUN_SUPABASE_INTEGRATION=true explicitly")
    settings = get_settings()
    expected_revision = os.getenv("EXPECTED_SUPABASE_REVISION", "0003")
    if not settings.database_url.startswith("postgresql"):
        pytest.skip("BLOCKED_EXTERNAL_CONFIGURATION: a PostgreSQL DATABASE_URL is required")
    engine = create_engine(settings.database_url, pool_pre_ping=True)
    with engine.connect() as connection:
        revision: str = connection.execute(
            text("select version_num from alembic_version")
        ).scalar_one()
        post_images: bool = connection.execute(
            text("select to_regclass('public.post_images') is not null")
        ).scalar_one()
        rls_count: int = connection.execute(
            text(
                "select count(*) from pg_class c "
                "join pg_namespace n on n.oid = c.relnamespace "
                "where n.nspname = 'public' and c.relrowsecurity"
            )
        ).scalar_one()
        bucket_count: int = connection.execute(
            text(
                "select count(*) from storage.buckets "
                "where id in ('product-images','post-images','banners','branding')"
            )
        ).scalar_one()
        storage_write_policies: int = connection.execute(
            text(
                "select count(*) from pg_policies where schemaname = 'storage' "
                "and tablename = 'objects' and cmd in ('INSERT','UPDATE','DELETE','ALL') "
                "and roles && array['anon','authenticated']::name[]"
            )
        ).scalar_one()
        missing_fk_indexes: int = connection.execute(
            text(
                "select count(*) from (values "
                "('post_images','ix_post_images_post_id'),"
                "('contact_clicks','ix_contact_clicks_product_id'),"
                "('media_assets','ix_media_assets_uploaded_by'),"
                "('audit_logs','ix_audit_logs_admin_user_id')"
                ") expected(table_name,index_name) "
                "where not exists (select 1 from pg_indexes i where i.schemaname='public' "
                "and i.tablename=expected.table_name and i.indexname=expected.index_name)"
            )
        ).scalar_one()
        alembic_rls: bool = connection.execute(
            text(
                "select c.relrowsecurity from pg_class c "
                "join pg_namespace n on n.oid=c.relnamespace "
                "where n.nspname='public' and c.relname='alembic_version'"
            )
        ).scalar_one()
        unsafe_client_grants: int = connection.execute(
            text(
                "select count(*) from information_schema.role_table_grants "
                "where table_schema='public' and grantee in ('anon','authenticated') "
                "and privilege_type <> 'SELECT'"
            )
        ).scalar_one()
        function_hardened: bool = connection.execute(
            text(
                "select exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) setting "
                "where setting in ('search_path=', 'search_path=\"\"')) "
                "and not has_function_privilege('anon', p.oid, 'execute') "
                "and not has_function_privilege('authenticated', p.oid, 'execute') "
                "from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
                "where n.nspname='public' and p.proname='set_updated_at' "
                "and pg_get_function_identity_arguments(p.oid)=''"
            )
        ).scalar_one()
    engine.dispose()
    assert revision == expected_revision
    assert post_images is True
    assert rls_count >= 11
    assert bucket_count == 4
    # Supabase grants table privileges to API roles and uses RLS as the
    # authorization boundary. Absence of write policies—not zero grants—is
    # what denies anonymous/authenticated mutations.
    assert storage_write_policies == 0
    assert missing_fk_indexes == 0
    if expected_revision == "0004":
        assert alembic_rls is True
        assert unsafe_client_grants == 0
        assert function_hardened is True
