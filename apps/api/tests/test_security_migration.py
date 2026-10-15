import re
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


SLUG_MIGRATION = ROOT / "supabase" / "migrations" / "20261015090000_product_slug_history.sql"
SLUG_WRAPPER = ROOT / "apps" / "api" / "alembic" / "versions" / "0006_product_slug_history.py"


def test_slug_history_migration_is_additive_and_private() -> None:
    sql = SLUG_MIGRATION.read_text(encoding="utf-8").lower()

    assert "create table public.product_slugs" in sql
    assert "slug varchar(260) not null unique" in sql
    assert "references public.products(id) on delete cascade" in sql
    assert "alter table public.product_slugs enable row level security" in sql
    assert "revoke all privileges on table public.product_slugs from anon, authenticated" in sql
    assert "set local lock_timeout" in sql  # never queue for long behind product writes
    # The guard keeps a historical slug with its product even for writers that ignore the table.
    assert "before insert or update of slug on public.products" in sql
    assert "constraint = 'products_slug_key'" in sql  # older backends map it to "Slug already exists"
    assert "set search_path = ''" in sql
    assert "revoke all on function public.product_slug_not_owned_elsewhere() from public, anon, authenticated" in sql
    code = re.sub(r"--[^\n]*", "", sql)
    bodies = re.findall(r"\$\$(.*?)\$\$", code, flags=re.S)
    assert len(bodies) == 1
    # The trigger body only reads: no write, DDL, dynamic SQL or privilege change, wherever it sits.
    for word in ("insert", "update", "delete", "merge", "truncate", "drop", "alter", "create",
                 "grant", "revoke", "execute", "perform", "copy", "set "):
        assert not re.search(rf"\b{word}", bodies[0]), word
    outside = re.sub(r"\$\$.*?\$\$", "", code, flags=re.S)
    # Outside it: nothing destructive in any position (ALTER ... DROP, data-changing CTEs, ...).
    for pattern in (r"\bdrop\b", r"\btruncate\b", r"\bdelete\s+from\b", r"\bupdate\s+[\w.]+\s+set\b",
                    r"\bmerge\b", r"\bgrant\b", r"\b(alter|create|drop)\s+policy\b",
                    r"\binsert\s+into\s+(?!public\.product_slugs\b)", r"(^|;)\s*(begin|commit|rollback)\b",
                    r"\bdisable\s+row\s+level\s+security\b", r"\bsecurity\s+definer\b"):
        assert not re.search(pattern, outside, flags=re.M), pattern


def test_alembic_wrapper_executes_only_the_canonical_0006_sql() -> None:
    wrapper = SLUG_WRAPPER.read_text(encoding="utf-8")

    assert 'revision = "0006"' in wrapper
    assert 'down_revision = "0005"' in wrapper
    assert '"20261015090000_product_slug_history.sql"' in wrapper
    assert "raise RuntimeError" in wrapper  # no downgrade: dropping the table breaks old links
