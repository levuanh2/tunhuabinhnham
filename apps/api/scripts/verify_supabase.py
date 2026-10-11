from sqlalchemy import create_engine, text

from app.core.config import get_settings

EXPECTED_TABLES = {
    "admin_users",
    "audit_logs",
    "banners",
    "categories",
    "contact_clicks",
    "media_assets",
    "posts",
    "post_images",
    "product_images",
    "products",
    "site_settings",
}
EXPECTED_BUCKETS = {"product-images", "post-images", "banners", "branding"}


def main() -> None:
    engine = create_engine(get_settings().database_url, pool_pre_ping=True)
    with engine.connect() as connection:
        tables: set[str] = set(
            connection.execute(
                text(
                    "select table_name from information_schema.tables "
                    "where table_schema = 'public'"
                )
            ).scalars()
        )
        rls_tables: set[str] = set(
            connection.execute(
                text(
                    "select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace "
                    "where n.nspname = 'public' and c.relrowsecurity"
                )
            ).scalars()
        )
        policies: int = connection.execute(
            text("select count(*) from pg_policies where schemaname = 'public'")
        ).scalar_one()
        buckets: set[str] = set(connection.execute(text("select id from storage.buckets")).scalars())
        revision: str = connection.execute(
            text("select version_num from alembic_version")
        ).scalar_one()
        categories: int = connection.execute(
            text("select count(*) from public.categories")
        ).scalar_one()
        settings: int = connection.execute(
            text("select count(*) from public.site_settings")
        ).scalar_one()

    missing_tables = EXPECTED_TABLES - tables
    missing_rls = EXPECTED_TABLES - rls_tables
    missing_buckets = EXPECTED_BUCKETS - buckets
    if missing_tables or missing_rls or missing_buckets or revision != "0003":
        raise SystemExit(
            f"Verification failed: tables={sorted(missing_tables)}, "
            f"rls={sorted(missing_rls)}, buckets={sorted(missing_buckets)}, revision={revision}"
        )
    print(
        "Supabase verified: "
        f"revision={revision}, tables={len(EXPECTED_TABLES)}, "
        f"rls_tables={len(EXPECTED_TABLES)}, policies={policies}, "
        f"buckets={len(EXPECTED_BUCKETS)}, categories={categories}, settings={settings}"
    )


if __name__ == "__main__":
    main()
