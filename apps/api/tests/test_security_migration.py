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
