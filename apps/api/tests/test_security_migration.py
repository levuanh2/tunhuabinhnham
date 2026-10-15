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


# The reviewed shape of migration 0006, statement by statement (lowercase, whitespace collapsed).
# Exact matches, not keyword scans: any other statement or clause (UPDATE ONLY, DISABLE TRIGGER,
# CALL, a data-changing CTE, SECURITY DEFINER, ...) fails here until it is reviewed and listed.
SLUG_STATEMENTS = [
    "set local lock_timeout = '5s'",  # never queue for long behind product writes
    "create table public.product_slugs ( id uuid primary key default gen_random_uuid(), "
    "product_id uuid not null references public.products(id) on delete cascade, "
    "slug varchar(260) not null unique, created_at timestamptz not null default now() )",
    "create index ix_product_slugs_product_id on public.product_slugs(product_id)",
    "alter table public.product_slugs enable row level security",
    "revoke all privileges on table public.product_slugs from anon, authenticated",
    "insert into public.product_slugs (product_id, slug, created_at) "
    "select id, slug, created_at from public.products",
    "create function public.record_product_slug() returns trigger language plpgsql "
    "set search_path = '' as $$body$$",
    "revoke all on function public.record_product_slug() from public, anon, authenticated",
    "create trigger record_product_slug after insert or update of slug on public.products "
    "for each row execute function public.record_product_slug()",
]
# The trigger only records slugs in product_slugs and refuses another product's; reported as
# products_slug_key so older backends answer their usual "Slug already exists".
SLUG_TRIGGER_BODY = (
    "begin if tg_op = 'update' then insert into public.product_slugs (product_id, slug) "
    "values (old.id, old.slug) on conflict (slug) do nothing; end if; "
    "insert into public.product_slugs (product_id, slug) values (new.id, new.slug) "
    "on conflict (slug) do nothing; if exists ( select 1 from public.product_slugs s "
    "where s.slug = new.slug and s.product_id <> new.id ) then raise exception "
    "'slug belongs to another product' using errcode = 'unique_violation', "
    "constraint = 'products_slug_key'; end if; return null; end"
)


def _normalized(text: str) -> str:
    return " ".join(text.split())


def test_slug_history_migration_is_exactly_the_reviewed_one() -> None:
    sql = SLUG_MIGRATION.read_text(encoding="utf-8").lower()
    # Comments only as whole lines, so nothing (a string, an inline comment) can hide text.
    code = "\n".join(line for line in sql.splitlines() if not line.lstrip().startswith("--"))
    assert "--" not in code and "/*" not in code
    head, body, tail = code.split("$$")  # exactly one dollar-quoted body
    assert _normalized(body) == SLUG_TRIGGER_BODY
    statements = [_normalized(part) for part in f"{head}$$body$${tail}".split(";") if part.strip()]
    assert statements == SLUG_STATEMENTS


def test_alembic_wrapper_executes_only_the_canonical_0006_sql() -> None:
    wrapper = SLUG_WRAPPER.read_text(encoding="utf-8")

    assert 'revision = "0006"' in wrapper
    assert 'down_revision = "0005"' in wrapper
    assert '"20261015090000_product_slug_history.sql"' in wrapper
    assert "raise RuntimeError" in wrapper  # no downgrade: dropping the table breaks old links
