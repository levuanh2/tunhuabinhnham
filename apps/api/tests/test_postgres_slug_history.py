"""Migration 0006 and slug-history concurrency on a real PostgreSQL (never SQLite).

Runs only with TEST_POSTGRES_URL pointing at a disposable local Supabase Postgres, e.g.
  docker run -d --name c21-pg-test -e POSTGRES_PASSWORD=localtest -p 127.0.0.1:55432:5432 \
    public.ecr.aws/supabase/postgres:17.11.0.004
  (plus the storage.buckets stub the canonical migrations expect, see the V1.1 report)
  TEST_POSTGRES_URL=postgresql+psycopg://postgres:localtest@127.0.0.1:55432/postgres
"""

import os
import subprocess
import sys
import uuid
from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.auth import CurrentAdmin, require_admin
from app.db.session import get_db
from app.main import app

URL = os.environ.get("TEST_POSTGRES_URL", "")
pytestmark = [
    pytest.mark.integration_postgres,
    pytest.mark.skipif(not URL, reason="TEST_POSTGRES_URL not set"),
]
API_DIR = Path(__file__).resolve().parents[1]
ADMIN = "/api/v1/admin/products"


def alembic(*args: str) -> None:
    assert "127.0.0.1" in URL or "localhost" in URL, "disposable local database only"
    subprocess.run(
        [sys.executable, "-m", "alembic", "-c", str(API_DIR / "alembic.ini"), *args],
        check=True, cwd=API_DIR, env={**os.environ, "DATABASE_URL": URL},
    )


@pytest.fixture(scope="module")
def engine() -> Generator[Engine, None, None]:
    alembic("upgrade", "0005")
    engine = create_engine(URL, pool_size=20, max_overflow=0)
    with engine.begin() as connection:
        # Products that exist before 0006, one soft-deleted, inserted the way the old API did.
        connection.execute(text(
            "insert into public.products (name, slug, sku, publish_status, published_at, deleted_at) values "
            "('Cũ', 'truoc-0006', 'TRUOC-0006', 'published', now(), null), "
            "('Đã xóa', 'da-xoa', 'DA-XOA', 'published', now(), now())"
        ))
        before = connection.execute(text(
            "select md5(string_agg(p::text, '|' order by p.id)) from public.products p"
        )).scalar_one()
    alembic("upgrade", "head")
    with engine.connect() as connection:
        after = connection.execute(text(
            "select md5(string_agg(p::text, '|' order by p.id)) from public.products p"
        )).scalar_one()
    assert before == after, "the migration must not change product rows"
    yield engine
    engine.dispose()


@pytest.fixture
def api(engine: Engine) -> Generator[TestClient, None, None]:
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    auth_user = uuid.uuid4()
    with engine.begin() as connection:
        connection.execute(text("insert into auth.users (id) values (:id)"), {"id": auth_user})
        admin_id = connection.execute(text(
            "insert into public.admin_users (auth_user_id, email, role) values (:id, :email, 'admin') "
            "returning id"
        ), {"id": auth_user, "email": f"{auth_user}@example.com"}).scalar_one()
    admin = CurrentAdmin(id=admin_id, auth_user_id=auth_user, email="a@example.com", role="admin")

    def session() -> Generator[Session, None, None]:
        with sessions() as db:
            yield db

    app.dependency_overrides[get_db] = session
    app.dependency_overrides[require_admin] = lambda: admin
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client
    app.dependency_overrides.clear()


def unique(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def create(api: TestClient, slug: str) -> dict:
    response = api.post(ADMIN, json={"name": slug, "slug": slug, "sku": slug.upper(), "publish_status": "published"})
    assert response.status_code == 201, response.text
    return response.json()


def get(api: TestClient, slug: str) -> tuple[int, str | None]:
    response = api.get(f"/api/v1/products/{slug}", follow_redirects=False)
    return response.status_code, response.headers.get("location")


def test_migration_backfills_and_keeps_the_table_private(engine: Engine) -> None:
    with engine.connect() as connection:
        rows = dict(connection.execute(text(
            "select s.slug, s.product_id = p.id from public.product_slugs s join public.products p on p.slug = s.slug "
            "where s.slug in ('truoc-0006', 'da-xoa')"
        )).all())
        assert rows == {"truoc-0006": True, "da-xoa": True}
        assert connection.execute(text(
            "select relrowsecurity from pg_class where oid = 'public.product_slugs'::regclass"
        )).scalar_one() is True
        for role in ("anon", "authenticated"):
            for privilege in ("select", "insert", "update", "delete"):
                assert connection.execute(text(
                    "select has_table_privilege(:role, 'public.product_slugs', :privilege)"
                ), {"role": role, "privilege": privilege}).scalar_one() is False, (role, privilege)
        constraint = connection.execute(text(
            "select conname from pg_constraint where conrelid = 'public.product_slugs'::regclass and contype = 'u'"
        )).scalar_one()
        assert constraint == "product_slugs_slug_key"  # mapped to "Slug already exists"
        # 0005 is intact: hidden-category policies still in place.
        quals = connection.execute(text(
            "select string_agg(qual, ' ') from pg_policies where tablename in ('products', 'product_images')"
        )).scalar_one()
        assert quals.count("categories") == 2


def test_rls_denies_the_data_api_roles(engine: Engine) -> None:
    for role in ("anon", "authenticated"):
        with engine.connect() as connection, pytest.raises(Exception, match="permission denied"):
            connection.execute(text(f"set local role {role}"))
            connection.execute(text("select 1 from public.product_slugs limit 1"))


def test_product_from_before_the_migration_can_move(api: TestClient) -> None:
    product = next(p for p in api.get(f"{ADMIN}?page_size=100").json()["items"] if p["slug"] == "truoc-0006")
    target = unique("sau-0006")
    assert api.patch(f"{ADMIN}/{product['id']}", json={"slug": target}).status_code == 200
    assert get(api, "truoc-0006") == (301, f"/api/v1/products/{target}")
    assert get(api, target)[0] == 200


def test_two_products_racing_for_one_slug_one_wins(api: TestClient) -> None:
    products = [create(api, unique("dua")) for _ in range(8)]
    wanted = unique("muon")
    with ThreadPoolExecutor(8) as pool:
        codes = sorted(pool.map(
            lambda product: api.patch(f"{ADMIN}/{product['id']}", json={"slug": wanted}).status_code, products
        ))
    assert codes == [200] + [409] * 7
    assert get(api, wanted)[0] == 200


def test_one_product_renamed_by_several_admins_at_once(api: TestClient, engine: Engine) -> None:
    start = unique("goc")
    product = create(api, start)
    targets = [unique("song-song") for _ in range(8)]
    with ThreadPoolExecutor(8) as pool:
        codes = list(pool.map(lambda slug: api.patch(f"{ADMIN}/{product['id']}", json={"slug": slug}).status_code, targets))
    assert codes == [200] * 8  # the row lock serialises them; the last one wins
    current = api.get(f"{ADMIN}/{product['id']}").json()["slug"]
    assert current in targets
    for old in [start, *targets]:
        if old != current:
            assert get(api, old) == (301, f"/api/v1/products/{current}"), old  # never a chain
    with engine.connect() as connection:
        stored = connection.execute(text(
            "select count(*) from public.product_slugs where product_id = :id"
        ), {"id": product["id"]}).scalar_one()
    assert stored == 9


def test_rename_while_another_admin_hides_the_product(api: TestClient) -> None:
    start, target = unique("an"), unique("an-moi")
    product = create(api, start)
    with ThreadPoolExecutor(2) as pool:
        renamed = pool.submit(api.patch, f"{ADMIN}/{product['id']}", json={"slug": target})
        hidden = pool.submit(api.patch, f"{ADMIN}/{product['id']}", json={"is_visible": False})
        assert (renamed.result().status_code, hidden.result().status_code) == (200, 200)
    stored = api.get(f"{ADMIN}/{product['id']}").json()
    assert (stored["slug"], stored["is_visible"]) == (target, False)
    assert get(api, start) == (404, None) and get(api, target) == (404, None)


def test_retried_rename_at_the_same_time_records_once(api: TestClient, engine: Engine) -> None:
    product = create(api, unique("thu-lai"))
    target = unique("thu-lai-moi")
    with ThreadPoolExecutor(2) as pool:
        codes = list(pool.map(lambda _: api.patch(f"{ADMIN}/{product['id']}", json={"slug": target}).status_code, range(2)))
    assert codes == [200, 200]
    with engine.connect() as connection:
        assert connection.execute(text(
            "select count(*) from public.product_slugs where product_id = :id"
        ), {"id": product["id"]}).scalar_one() == 2


def test_refused_rename_rolls_back_everything(api: TestClient, engine: Engine) -> None:
    taken = create(api, unique("da-co"))
    product = create(api, unique("giu"))
    refused = api.patch(f"{ADMIN}/{product['id']}", json={"slug": taken["slug"], "name": "Tên khác"})
    assert refused.status_code == 409
    stored = api.get(f"{ADMIN}/{product['id']}").json()
    assert (stored["slug"], stored["name"]) == (product["slug"], product["name"])


def test_database_refuses_a_second_owner_even_without_the_api(engine: Engine, api: TestClient) -> None:
    owner = create(api, unique("chu"))
    other = create(api, unique("khac"))
    with engine.connect() as connection, pytest.raises(Exception, match="product_slugs_slug_key"):
        connection.execute(text(
            "insert into public.product_slugs (product_id, slug) values (:id, :slug)"
        ), {"id": other["id"], "slug": owner["slug"]})


def test_downgrade_is_refused(engine: Engine) -> None:
    with pytest.raises(subprocess.CalledProcessError):
        alembic("downgrade", "0005")
    with engine.connect() as connection:
        assert connection.execute(text("select version_num from public.alembic_version")).scalar_one() == "0006"
