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
