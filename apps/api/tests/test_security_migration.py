from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MIGRATION = ROOT / "supabase" / "migrations" / "20261011041446_security_hardening.sql"
ALEMBIC_WRAPPER = (
    ROOT / "apps" / "api" / "alembic" / "versions" / "0004_security_hardening.py"
)


def test_security_migration_is_incremental_and_non_destructive() -> None:
    sql = MIGRATION.read_text(encoding="utf-8").lower()

    assert "alter table public.alembic_version enable row level security" in sql
    assert "revoke all privileges on table public.alembic_version" in sql
    assert "alter function public.set_updated_at() set search_path = ''" in sql
    assert "revoke execute on function public.set_updated_at()" in sql
    assert "grant select on table" in sql
    assert "to anon, authenticated" in sql
    assert "grant insert" not in sql
    assert "grant update" not in sql
    assert "grant delete" not in sql
    assert "drop table" not in sql
    assert "truncate" not in sql


def test_alembic_wrapper_executes_only_the_canonical_0004_sql() -> None:
    wrapper = ALEMBIC_WRAPPER.read_text(encoding="utf-8")

    assert 'revision = "0004"' in wrapper
    assert 'down_revision = "0003"' in wrapper
    assert '"20261011041446_security_hardening.sql"' in wrapper
    assert "op.execute(sql_path.read_text" in wrapper
    assert "Security downgrade is intentionally disabled" in wrapper


RLS_MIGRATION = ROOT / "supabase" / "migrations" / "20261014090000_rls_hidden_categories.sql"
RLS_WRAPPER = ROOT / "apps" / "api" / "alembic" / "versions" / "0005_rls_hidden_categories.py"


def test_rls_hidden_category_migration_only_alters_the_two_policies() -> None:
    sql = RLS_MIGRATION.read_text(encoding="utf-8").lower()

    assert sql.count("alter policy") == 2
    assert 'alter policy "public read published products" on public.products' in sql
    assert 'alter policy "public read product images" on public.product_images' in sql
    assert sql.count("c.is_visible and c.deleted_at is null") == 2
    for forbidden in ("drop ", "create ", "grant ", "revoke ", "truncate", "delete ", "update ",
                      "insert ", "begin", "commit"):
        assert forbidden not in sql, forbidden


def test_alembic_wrapper_executes_only_the_canonical_0005_sql() -> None:
    wrapper = RLS_WRAPPER.read_text(encoding="utf-8")

    assert 'revision = "0005"' in wrapper
    assert 'down_revision = "0004"' in wrapper
    assert '"20261014090000_rls_hidden_categories.sql"' in wrapper
    assert "op.execute(sql_path.read_text" in wrapper
