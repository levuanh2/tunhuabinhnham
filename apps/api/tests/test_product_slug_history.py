"""V1.1: a once-public product may change its URL; every old URL keeps pointing at it."""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuditLog, Product, ProductSlug

ADMIN = "/api/v1/admin/products"


def create(client: TestClient, slug: str, publish_status: str = "published", **extra: object) -> dict:
    created = client.post(
        ADMIN,
        json={"name": slug, "slug": slug, "sku": slug.upper(), "publish_status": publish_status, **extra},
    )
    assert created.status_code == 201, created.text
    return created.json()


def rename(client: TestClient, product: dict, slug: str, **extra: object):
    return client.patch(f"{ADMIN}/{product['id']}", json={"slug": slug, **extra})


def history(db: Session, product: dict) -> list[str]:
    db.expire_all()
    return sorted(
        db.scalars(select(ProductSlug.slug).where(ProductSlug.product_id == uuid.UUID(product["id"])))
    )


def test_old_url_redirects_permanently_to_the_current_one(admin_client: TestClient) -> None:
    product = create(admin_client, "tu-nhua-4-canh", price="1250000")
    changed = rename(admin_client, product, "tu-quan-ao-nhua-4-canh")
    assert changed.status_code == 200, changed.text
    after = changed.json()
    # Only the URL changes: id, SKU, price and images are untouched.
    assert (after["id"], after["sku"], after["images"]) == (product["id"], product["sku"], product["images"])
    assert Decimal(after["price"]) == Decimal(product["price"]) == 1250000
    old = admin_client.get("/api/v1/products/tu-nhua-4-canh?ref=zalo&x=1", follow_redirects=False)
    assert old.status_code == 301
    assert old.headers["location"] == "/api/v1/products/tu-quan-ao-nhua-4-canh?ref=zalo&x=1"
    assert "no-store" in old.headers["cache-control"]
    new = admin_client.get("/api/v1/products/tu-quan-ao-nhua-4-canh", follow_redirects=False)
    assert new.status_code == 200
    assert new.json()["id"] == product["id"]


def test_every_old_url_points_straight_at_the_latest_one(admin_client: TestClient, db: Session) -> None:
    product = create(admin_client, "a")
    assert rename(admin_client, product, "b").status_code == 200
    assert rename(admin_client, product, "c").status_code == 200
    for old in ("a", "b"):
        response = admin_client.get(f"/api/v1/products/{old}", follow_redirects=False)
        assert (response.status_code, response.headers["location"]) == (301, "/api/v1/products/c")
    assert admin_client.get("/api/v1/products/c", follow_redirects=False).status_code == 200
    assert history(db, product) == ["a", "b", "c"]


def test_going_back_to_an_old_url_never_loops(admin_client: TestClient, db: Session) -> None:
    product = create(admin_client, "a")
    rename(admin_client, product, "b")
    back = rename(admin_client, product, "a")
    assert back.status_code == 200, back.text
    assert admin_client.get("/api/v1/products/a", follow_redirects=False).status_code == 200
    response = admin_client.get("/api/v1/products/b", follow_redirects=False)
    assert (response.status_code, response.headers["location"]) == (301, "/api/v1/products/a")
    assert history(db, product) == ["a", "b"]  # no duplicate row for "a"


def test_an_old_url_is_never_given_to_another_product(admin_client: TestClient) -> None:
    first = create(admin_client, "a")
    rename(admin_client, first, "b")
    taken = create(admin_client, "khac")
    for attempt in (
        admin_client.post(ADMIN, json={"name": "x", "slug": "a", "sku": "X-1", "publish_status": "draft"}),
        rename(admin_client, taken, "a"),
        rename(admin_client, taken, "b"),  # the current URL of the first product
    ):
        assert attempt.status_code == 409
        assert attempt.json()["error"]["message"] == "Slug already exists"
    assert admin_client.get("/api/v1/products/a", follow_redirects=False).headers["location"] == (
        "/api/v1/products/b"
    )


def test_failed_rename_changes_nothing(admin_client: TestClient, db: Session) -> None:
    first = create(admin_client, "a")
    second = create(admin_client, "b")
    failed = rename(admin_client, second, "a", name="Đổi tên", price="99")
    assert failed.status_code == 409
    stored = admin_client.get(f"{ADMIN}/{second['id']}").json()
    assert (stored["slug"], stored["name"], stored["price"]) == ("b", "b", None)
    assert history(db, second) == ["b"] and history(db, first) == ["a"]


def test_repeating_a_rename_after_a_timeout_is_harmless(admin_client: TestClient, db: Session) -> None:
    product = create(admin_client, "a")
    assert rename(admin_client, product, "b").status_code == 200
    assert rename(admin_client, product, "b").status_code == 200
    assert history(db, product) == ["a", "b"]


def test_editing_the_name_keeps_the_url(admin_client: TestClient, db: Session) -> None:
    product = create(admin_client, "giu-url")
    changed = admin_client.patch(f"{ADMIN}/{product['id']}", json={"name": "Tên hoàn toàn mới"})
    assert changed.json()["slug"] == "giu-url"
    assert history(db, product) == ["giu-url"]


def test_draft_urls_never_public_are_not_kept(admin_client: TestClient, db: Session) -> None:
    draft = create(admin_client, "go-nham", "draft")
    assert rename(admin_client, draft, "dung-roi").status_code == 200
    assert history(db, draft) == ["dung-roi"]
    # The typo is free again for any product, and it never redirects.
    assert admin_client.get("/api/v1/products/go-nham").status_code == 404
    assert admin_client.post(ADMIN, json={"name": "y", "slug": "go-nham", "sku": "Y-1"}).status_code == 201


def test_old_urls_never_reveal_a_product_that_is_not_public(admin_client: TestClient) -> None:
    category = admin_client.post("/api/v1/admin/categories", json={"name": "Loại", "slug": "loai"}).json()
    product = create(admin_client, "cu", category_id=category["id"])
    rename(admin_client, product, "moi")

    def both() -> tuple[int, int]:
        return tuple(  # type: ignore[return-value]
            admin_client.get(f"/api/v1/products/{slug}", follow_redirects=False).status_code
            for slug in ("cu", "moi")
        )

    assert both() == (301, 200)
    for hide, show in (
        ({"is_visible": False}, {"is_visible": True}),
        ({"publish_status": "draft"}, {"publish_status": "published"}),
        (
            {"published_at": (datetime.now(UTC) + timedelta(days=3)).isoformat()},
            {"published_at": datetime.now(UTC).isoformat()},
        ),
    ):
        admin_client.patch(f"{ADMIN}/{product['id']}", json=hide)
        assert both() == (404, 404), hide
        admin_client.patch(f"{ADMIN}/{product['id']}", json=show)
        assert both() == (301, 200), show
    admin_client.patch(f"/api/v1/admin/categories/{category['id']}", json={"is_visible": False})
    assert both() == (404, 404)
    admin_client.patch(f"/api/v1/admin/categories/{category['id']}", json={"is_visible": True})
    assert admin_client.delete(f"{ADMIN}/{product['id']}").status_code == 204
    assert both() == (404, 404)


def test_published_date_cannot_be_cleared(admin_client: TestClient) -> None:
    # published_at marks a URL as having been public, which is what keeps it as a redirect.
    product = create(admin_client, "da-dang")
    cleared = admin_client.patch(f"{ADMIN}/{product['id']}", json={"published_at": None})
    assert cleared.status_code == 409
    assert cleared.json()["error"]["message"] == "Published date cannot be cleared"


def test_rename_is_audited(admin_client: TestClient, db: Session) -> None:
    product = create(admin_client, "a")
    rename(admin_client, product, "b")
    logged = db.scalars(
        select(AuditLog).where(AuditLog.entity_id == uuid.UUID(product["id"]), AuditLog.action == "update")
    ).all()
    assert any(log.changes.get("slug") == "b" and log.changes.get("previous_slug") == "a" for log in logged)


def test_renaming_needs_an_admin(client: TestClient, db: Session) -> None:
    product = Product(name="x", slug="x", sku="X", publish_status="published", published_at=datetime.now(UTC))
    db.add(product)
    db.commit()
    assert client.patch(f"{ADMIN}/{product.id}", json={"slug": "y"}).status_code == 401
    db.refresh(product)
    assert product.slug == "x"
