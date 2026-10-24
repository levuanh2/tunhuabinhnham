from datetime import UTC, datetime
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import Category, Product, PublishStatus, StockStatus


def test_public_products_exclude_draft_hidden_and_deleted(client: TestClient, db: Session) -> None:
    category = Category(name="Đồ dùng", slug="do-dung", is_visible=True)
    db.add(category)
    db.flush()
    db.add_all(
        [
            Product(
                name="Công khai",
                slug="cong-khai",
                sku="PUB-1",
                category_id=category.id,
                price=Decimal("120000"),
                stock_status=StockStatus.in_stock,
                publish_status=PublishStatus.published,
                is_visible=True,
                published_at=datetime.now(UTC),
            ),
            Product(
                name="Nháp",
                slug="nhap",
                sku="DRAFT-1",
                publish_status=PublishStatus.draft,
                is_visible=True,
            ),
            Product(
                name="Ẩn",
                slug="an",
                sku="HIDDEN-1",
                publish_status=PublishStatus.published,
                is_visible=False,
            ),
        ]
    )
    db.commit()
    response = client.get("/api/v1/products")
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["slug"] == "cong-khai"


def test_filter_validation(client: TestClient) -> None:
    response = client.get("/api/v1/products?min_price=200&max_price=100")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "http_422"


def test_pagination_limits(client: TestClient) -> None:
    response = client.get("/api/v1/products?page_size=101")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def _product(slug: str, category: Category | None, **overrides: object) -> Product:
    values: dict[str, object] = {
        "name": slug,
        "slug": slug,
        "sku": slug.upper(),
        "category_id": category.id if category else None,
        "publish_status": PublishStatus.published,
        "is_visible": True,
        "published_at": datetime.now(UTC),
    }
    return Product(**(values | overrides))


def test_product_with_related_in_one_response(client: TestClient, db: Session) -> None:
    """The product page gets the product and its "same category" products in one request, with as many
    database statements as the product alone."""
    from sqlalchemy import event

    from tests.conftest import engine

    wardrobes = Category(name="Tủ quần áo", slug="tu-quan-ao", is_visible=True)
    shelves = Category(name="Kệ", slug="ke", is_visible=True)
    hidden = Category(name="Ẩn", slug="loai-an", is_visible=False)
    db.add_all([wardrobes, shelves, hidden])
    db.flush()
    older = datetime(2026, 1, 1, tzinfo=UTC)
    db.add_all(
        [
            _product("tu-a", wardrobes, published_at=older),
            _product("tu-b", wardrobes),
            _product("tu-c", wardrobes, published_at=datetime(2026, 2, 1, tzinfo=UTC)),
            _product("tu-nhap", wardrobes, publish_status=PublishStatus.draft),
            _product("ke-a", shelves),
            _product("khong-loai", None),
            _product("trong-loai-an", hidden),
        ]
    )
    db.commit()

    def get(path: str) -> tuple[str | None, list[str]]:
        response = client.get(f"/api/v1/products/{path}")
        body = response.json()
        return (body.get("slug"), [item["slug"] for item in body.get("related", [])])

    # same category, public only, itself excluded, newest first, at most `related`
    assert get("tu-a?related=4") == ("tu-a", ["tu-b", "tu-c"])
    assert get("tu-a?related=1") == ("tu-a", ["tu-b"])
    # without the parameter: the product as before (the new field is empty)
    assert get("tu-a") == ("tu-a", [])
    # no category: any public product, minus itself
    assert sorted(get("khong-loai?related=4")[1]) == ["ke-a", "tu-a", "tu-b", "tu-c"]
    # unknown, draft or hidden: 404 as before
    for slug in ("khong-co", "tu-nhap", "trong-loai-an"):
        assert client.get(f"/api/v1/products/{slug}?related=4").status_code == 404
    assert client.get("/api/v1/products/tu-a?related=13").status_code == 422

    statements: list[str] = []

    def count(*args: object) -> None:
        statements.append(str(args[2]))

    event.listen(engine, "before_cursor_execute", count)
    try:
        client.get("/api/v1/products/tu-a")
        alone = len(statements)
        statements.clear()
        client.get("/api/v1/products/tu-a?related=4")
        assert len(statements) == alone, statements
    finally:
        event.remove(engine, "before_cursor_execute", count)
