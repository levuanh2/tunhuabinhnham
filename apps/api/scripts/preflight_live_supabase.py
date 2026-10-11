"""Read-only safety preflight for the explicitly approved live Supabase project."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import NullPool

from app.core.config import get_settings

BASELINE_TABLES = {
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
EXPECTED_POLICIES = {
    "public read visible categories",
    "public read published products",
    "public read product images",
    "public read published posts",
    "public read published post images",
    "public read active banners",
    "public read site settings",
}
EXPECTED_BUCKETS = {"product-images", "post-images", "banners", "branding"}
EXPECTED_INDEXES = {
    "ix_admin_users_auth_user_id",
    "ix_categories_slug",
    "ix_categories_visible",
    "ix_products_name_search",
    "ix_products_public",
    "ix_products_category",
    "uq_product_primary_image",
    "ix_posts_public",
    "ix_post_images_post_id",
    "ix_banners_active",
    "ix_contact_clicks_created",
    "ix_contact_clicks_product_id",
    "ix_audit_entity",
    "ix_audit_logs_admin_user_id",
    "ix_media_assets_uploaded_by",
}


def _project_ref(url: str) -> str | None:
    match = re.fullmatch(r"https://([a-z0-9]+)\.supabase\.co/?", url.strip())
    return match.group(1) if match else None


def _fingerprint(value: str | None) -> str:
    if not value:
        return "unresolved"
    return hashlib.sha256(value.encode()).hexdigest()[:12]


def main() -> None:
    settings = get_settings()
    if not settings.database_url.startswith("postgresql"):
        raise SystemExit("Safety preflight requires PostgreSQL")
    ref = _project_ref(settings.supabase_url)
    engine = create_engine(
        settings.database_url,
        poolclass=NullPool,
        connect_args={
            "connect_timeout": settings.db_connect_timeout_seconds,
            "sslmode": "require",
            "application_name": "tunhuabinhnham-preflight",
        },
    )
    report: dict[str, Any] = {"project_ref_fingerprint": _fingerprint(ref)}
    try:
        with engine.connect() as connection:
            connection.execute(text("set statement_timeout = '15s'"))
            revision_rows: list[str] = list(connection.execute(
                text("select version_num from public.alembic_version")
            ).scalars().all())
            tables = set(inspect(connection).get_table_names(schema="public"))
            report["revision"] = revision_rows
            report["tables"] = sorted(tables)
            report["missing_baseline_tables"] = sorted(BASELINE_TABLES - tables)
            report["unexpected_public_tables"] = sorted(
                tables - BASELINE_TABLES - {"alembic_version"}
            )
            report["row_counts"] = {
                table: connection.execute(
                    text(f'select count(*) from public."{table}"')
                ).scalar_one()
                for table in sorted(BASELINE_TABLES & tables)
            }
            report["managed_row_counts"] = {
                "auth.users": connection.execute(
                    text("select count(*) from auth.users")
                ).scalar_one(),
                "storage.objects": connection.execute(
                    text("select count(*) from storage.objects")
                ).scalar_one(),
            }
            report["synthetic_residue_counts"] = {
                "categories": connection.execute(
                    text("select count(*) from public.categories where name like '__e2e\\_%' escape '\\' or slug like 'e2e-%'")
                ).scalar_one(),
                "products": connection.execute(
                    text("select count(*) from public.products where name like '__e2e\\_%' escape '\\' or slug like 'e2e-%'")
                ).scalar_one(),
                "posts": connection.execute(
                    text("select count(*) from public.posts where title like '__e2e\\_%' escape '\\' or slug like 'e2e-%'")
                ).scalar_one(),
                "banners": connection.execute(
                    text("select count(*) from public.banners where title like '__e2e\\_%' escape '\\'")
                ).scalar_one(),
                "auth.users": connection.execute(
                    text("select count(*) from auth.users where email like '__e2e\\_%' escape '\\'")
                ).scalar_one(),
                "storage.objects": connection.execute(
                    text("select count(*) from storage.objects where name like '%__e2e\\_%' escape '\\'")
                ).scalar_one(),
            }
            indexes: set[str] = set(
                connection.execute(
                    text("select indexname from pg_indexes where schemaname = 'public'")
                ).scalars()
            )
            report["named_indexes"] = sorted(indexes)
            report["missing_expected_indexes"] = sorted(EXPECTED_INDEXES - indexes)
            rls_tables: set[str] = set(
                connection.execute(
                    text(
                        "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace "
                        "where n.nspname='public' and c.relkind='r' and c.relrowsecurity"
                    )
                ).scalars()
            )
            policies: set[str] = set(
                connection.execute(
                    text("select policyname from pg_policies where schemaname='public'")
                ).scalars()
            )
            report["rls_tables"] = sorted(rls_tables)
            report["missing_rls"] = sorted(BASELINE_TABLES - rls_tables)
            report["policies"] = sorted(policies)
            report["missing_policies"] = sorted(EXPECTED_POLICIES - policies)
            report["unexpected_policies"] = sorted(policies - EXPECTED_POLICIES)
            buckets = connection.execute(
                text(
                    "select id, public, file_size_limit, allowed_mime_types "
                    "from storage.buckets where id = any(:ids) order by id"
                ),
                {"ids": sorted(EXPECTED_BUCKETS)},
            ).mappings().all()
            report["buckets"] = [dict(row) for row in buckets]
            report["missing_buckets"] = sorted(
                EXPECTED_BUCKETS - {str(row["id"]) for row in buckets}
            )
            foreign_keys = connection.execute(
                text(
                    "select c.conrelid::regclass::text as table_name, c.conname, "
                    "pg_get_constraintdef(c.oid) as definition "
                    "from pg_constraint c join pg_namespace n on n.oid=c.connamespace "
                    "where n.nspname='public' and c.contype='f' order by 1,2"
                )
            ).mappings().all()
            report["foreign_keys"] = [dict(row) for row in foreign_keys]
            enums = connection.execute(
                text(
                    "select t.typname, array_agg(e.enumlabel order by e.enumsortorder) labels "
                    "from pg_type t join pg_enum e on e.enumtypid=t.oid "
                    "join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' "
                    "group by t.typname order by t.typname"
                )
            ).mappings().all()
            report["enums"] = [dict(row) for row in enums]
    finally:
        engine.dispose()
    print(json.dumps(report, ensure_ascii=False, indent=2, default=list))


if __name__ == "__main__":
    main()
