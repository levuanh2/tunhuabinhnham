"""Read-only audit of Supabase public-schema privileges and function safety."""

from __future__ import annotations

import json
import os
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from app.core.config import get_settings

CLIENT_ROLES = ("anon", "authenticated")
INTERNAL_TABLES = (
    "admin_users",
    "audit_logs",
    "contact_clicks",
    "media_assets",
)


def main() -> None:
    settings = get_settings()
    engine = create_engine(
        settings.database_url,
        poolclass=NullPool,
        connect_args={
            "connect_timeout": settings.db_connect_timeout_seconds,
            "sslmode": os.getenv("AUDIT_SSLMODE", "require"),
            "application_name": "tunhuabinhnham-security-audit",
        },
    )
    report: dict[str, Any] = {}
    try:
        with engine.connect() as connection:
            connection.execute(text("set statement_timeout = '15s'"))
            report["revision"] = connection.execute(
                text("select version_num from public.alembic_version")
            ).scalar_one()
            report["table_security"] = [
                dict(row)
                for row in connection.execute(
                    text(
                        "select c.relname as table_name, c.relrowsecurity as rls_enabled, "
                        "c.relforcerowsecurity as force_rls "
                        "from pg_class c join pg_namespace n on n.oid=c.relnamespace "
                        "where n.nspname='public' and c.relkind='r' order by c.relname"
                    )
                ).mappings()
            ]
            report["client_table_grants"] = [
                dict(row)
                for row in connection.execute(
                    text(
                        "select grantee, table_name, array_agg(privilege_type order by privilege_type) privileges "
                        "from information_schema.role_table_grants "
                        "where table_schema='public' and grantee = any(:roles) "
                        "group by grantee, table_name order by grantee, table_name"
                    ),
                    {"roles": list(CLIENT_ROLES)},
                ).mappings()
            ]
            report["internal_policy_counts"] = {
                table: connection.execute(
                    text(
                        "select count(*) from pg_policies "
                        "where schemaname='public' and tablename=:table"
                    ),
                    {"table": table},
                ).scalar_one()
                for table in INTERNAL_TABLES
            }
            function_row = connection.execute(
                text(
                    "select p.prosecdef as security_definer, p.proconfig, "
                    "has_function_privilege('anon', p.oid, 'execute') as anon_execute, "
                    "has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute, "
                    "exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a "
                    "where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute "
                    "from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
                    "where n.nspname='public' and p.proname='set_updated_at' "
                    "and pg_get_function_identity_arguments(p.oid)=''"
                )
            ).mappings().one()
            report["set_updated_at"] = dict(function_row)
    finally:
        engine.dispose()
    print(json.dumps(report, ensure_ascii=False, indent=2, default=list))


if __name__ == "__main__":
    main()
