import uuid
from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models import Category


def test_admin_requires_authentication(client: TestClient) -> None:
    response = client.get("/api/v1/admin/products")
    assert response.status_code == 401


def test_product_crud_and_soft_delete(admin_client: TestClient) -> None:
    payload = {
        "name": "Bình gốm",
        "slug": "binh-gom",
        "sku": "BG-001",
        "price": "450000.00",
        "stock_status": "in_stock",
        "publish_status": "published",
        "is_visible": True,
        "is_featured": False,
        "attributes": {"Chất liệu": "Gốm"},
        "images": [],
    }
    created = admin_client.post("/api/v1/admin/products", json=payload)
    assert created.status_code == 201, created.text
    product_id = created.json()["id"]
    updated = admin_client.patch(
        f"/api/v1/admin/products/{product_id}", json={"name": "Bình gốm men lam"}
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Bình gốm men lam"
    deleted = admin_client.delete(f"/api/v1/admin/products/{product_id}")
    assert deleted.status_code == 204
    assert admin_client.get(f"/api/v1/admin/products/{product_id}").status_code == 404


def test_duplicate_sku_returns_conflict(admin_client: TestClient) -> None:
    payload = {
        "name": "A",
        "slug": "a",
        "sku": "ONE",
        "stock_status": "contact",
        "publish_status": "draft",
        "attributes": {},
        "images": [],
    }
    assert admin_client.post("/api/v1/admin/products", json=payload).status_code == 201
    payload.update({"name": "B", "slug": "b"})
    conflict = admin_client.post("/api/v1/admin/products", json=payload)
    assert conflict.status_code == 409
    assert conflict.json()["error"]["message"] == "SKU already exists"


def test_duplicate_product_slug_returns_precise_conflict(admin_client: TestClient) -> None:
    first = {
        "name": "A",
        "slug": "same-slug",
        "sku": "SKU-A",
        "images": [],
    }
    second = {**first, "name": "B", "sku": "SKU-B"}
    assert admin_client.post("/api/v1/admin/products", json=first).status_code == 201

    conflict = admin_client.post("/api/v1/admin/products", json=second)

    assert conflict.status_code == 409
    assert conflict.json()["error"]["message"] == "Slug already exists"


def test_duplicate_image_storage_key_returns_precise_conflict(
    admin_client: TestClient,
) -> None:
    image = {
        "storage_key": "2026/10/shared.webp",
        "url": "https://example.com/shared.webp",
        "sort_order": 0,
        "is_primary": True,
    }
    first = {"name": "A", "slug": "image-a", "sku": "IMAGE-A", "images": [image]}
    second = {"name": "B", "slug": "image-b", "sku": "IMAGE-B", "images": [image]}
    assert admin_client.post("/api/v1/admin/products", json=first).status_code == 201

    conflict = admin_client.post("/api/v1/admin/products", json=second)

    assert conflict.status_code == 409
    assert conflict.json()["error"]["message"] == "Image storage key already exists"
    assert "product_images.storage_key" not in conflict.text


def test_product_update_preserves_existing_image_storage_key(admin_client: TestClient) -> None:
    image = {
        "storage_key": "2026/10/image.webp",
        "url": "https://example.supabase.co/storage/v1/object/public/product-images/2026/10/image.webp",
        "alt_text": "Mặt trước",
        "sort_order": 0,
        "is_primary": True,
    }
    created = admin_client.post(
        "/api/v1/admin/products",
        json={
            "name": "Tủ nhựa",
            "slug": "tu-nhua",
            "sku": "TN-01",
            "images": [image],
        },
    )
    assert created.status_code == 201, created.text
    product_id = created.json()["id"]

    image["alt_text"] = "Mặt trước đã cập nhật"
    updated = admin_client.patch(
        f"/api/v1/admin/products/{product_id}", json={"images": [image]}
    )

    assert updated.status_code == 200, updated.text
    assert updated.json()["images"][0]["storage_key"] == image["storage_key"]
    assert updated.json()["images"][0]["alt_text"] == "Mặt trước đã cập nhật"


def test_product_update_swaps_existing_image_order_and_primary(admin_client: TestClient) -> None:
    first = {
        "storage_key": "2026/10/front.webp",
        "url": "https://example.com/front.webp",
        "alt_text": "Front",
        "sort_order": 0,
        "is_primary": True,
    }
    second = {
        "storage_key": "2026/10/back.webp",
        "url": "https://example.com/back.webp",
        "alt_text": "Back",
        "sort_order": 1,
        "is_primary": False,
    }
    created = admin_client.post(
        "/api/v1/admin/products",
        json={
            "name": "Reorderable product",
            "slug": "reorderable-product",
            "sku": "REORDER-01",
            "images": [first, second],
        },
    )
    assert created.status_code == 201, created.text

    first.update(sort_order=1, is_primary=False)
    second.update(sort_order=0, is_primary=True)
    updated = admin_client.patch(
        f"/api/v1/admin/products/{created.json()['id']}",
        json={"images": [second, first]},
    )

    assert updated.status_code == 200, updated.text
    images = {image["storage_key"]: image for image in updated.json()["images"]}
    assert images[first["storage_key"]]["sort_order"] == 1
    assert images[first["storage_key"]]["is_primary"] is False
    assert images[second["storage_key"]]["sort_order"] == 0
    assert images[second["storage_key"]]["is_primary"] is True


def test_admin_categories_report_product_count_and_block_deleting_used_ones(
    admin_client: TestClient,
) -> None:
    used = admin_client.post(
        "/api/v1/admin/categories", json={"name": "Tủ quần áo", "slug": "tu-quan-ao"}
    ).json()
    empty = admin_client.post(
        "/api/v1/admin/categories", json={"name": "Kệ nhựa", "slug": "ke-nhua"}
    ).json()
    for slug, publish_status in (("tu-a", "published"), ("tu-b", "draft")):
        created = admin_client.post(
            "/api/v1/admin/products",
            json={
                "name": slug,
                "slug": slug,
                "sku": slug.upper(),
                "category_id": used["id"],
                "publish_status": publish_status,
                "images": [],
            },
        )
        assert created.status_code == 201, created.text

    counts = {c["slug"]: c["product_count"] for c in admin_client.get("/api/v1/admin/categories").json()}
    assert counts == {"tu-quan-ao": 2, "ke-nhua": 0}
    # The public contract is unchanged: no admin-only field.
    assert "product_count" not in admin_client.get("/api/v1/categories").json()[0]

    blocked = admin_client.delete(f"/api/v1/admin/categories/{used['id']}")
    assert blocked.status_code == 409
    assert blocked.json()["error"]["message"] == "Category has products"
    assert used["id"] in {c["id"] for c in admin_client.get("/api/v1/admin/categories").json()}

    assert admin_client.delete(f"/api/v1/admin/categories/{empty['id']}").status_code == 204
    assert empty["id"] not in {c["id"] for c in admin_client.get("/api/v1/admin/categories").json()}


def test_deleted_products_do_not_block_category_delete(admin_client: TestClient) -> None:
    category = admin_client.post(
        "/api/v1/admin/categories", json={"name": "Tủ giày dép", "slug": "tu-giay-dep"}
    ).json()
    product = admin_client.post(
        "/api/v1/admin/products",
        json={"name": "A", "slug": "a-giay", "sku": "A-GIAY", "category_id": category["id"], "images": []},
    ).json()
    assert admin_client.delete(f"/api/v1/admin/products/{product['id']}").status_code == 204
    assert admin_client.delete(f"/api/v1/admin/categories/{category['id']}").status_code == 204


def test_duplicate_category_slug_returns_conflict(admin_client: TestClient) -> None:
    payload = {"name": "Tủ đa năng", "slug": "tu-da-nang"}
    assert admin_client.post("/api/v1/admin/categories", json=payload).status_code == 201
    conflict = admin_client.post("/api/v1/admin/categories", json={**payload, "name": "Tủ đa năng 2"})
    assert conflict.status_code == 409
    assert conflict.json()["error"]["message"] == "Slug already exists"


def test_published_product_keeps_its_slug(admin_client: TestClient) -> None:
    # No redirect from old product URLs exists, so the API refuses to break a public URL,
    # including when a second admin saves a stale form after someone else published it.
    def create(slug: str, publish_status: str) -> str:
        created = admin_client.post(
            "/api/v1/admin/products",
            json={"name": slug, "slug": slug, "sku": slug.upper(), "publish_status": publish_status},
        )
        assert created.status_code == 201, created.text
        return str(created.json()["id"])

    published = create("giu-url", "published")
    changed = admin_client.patch(f"/api/v1/admin/products/{published}", json={"slug": "url-moi"})
    assert changed.status_code == 409
    assert changed.json()["error"]["message"] == "Published product URL cannot change"
    same = admin_client.patch(
        f"/api/v1/admin/products/{published}", json={"slug": "giu-url", "name": "Tên mới"}
    )
    assert same.status_code == 200
    unpublished = admin_client.patch(
        f"/api/v1/admin/products/{published}", json={"publish_status": "draft", "slug": "lan-nua"}
    )
    assert unpublished.status_code == 409  # once public, always kept (published_at stays set)

    draft = create("ban-nhap", "draft")
    renamed = admin_client.patch(f"/api/v1/admin/products/{draft}", json={"slug": "ban-nhap-moi"})
    assert renamed.status_code == 200
    assert renamed.json()["slug"] == "ban-nhap-moi"
    admin_client.patch(f"/api/v1/admin/products/{draft}", json={"publish_status": "published"})
    stale = admin_client.patch(
        f"/api/v1/admin/products/{draft}", json={"publish_status": "draft", "slug": "doi-sau-khi-dang"}
    )
    assert stale.status_code == 409


def test_products_cannot_be_assigned_to_a_deleted_category(admin_client: TestClient) -> None:
    gone = admin_client.post("/api/v1/admin/categories", json={"name": "Cũ", "slug": "cu"}).json()
    live = admin_client.post("/api/v1/admin/categories", json={"name": "Mới", "slug": "moi"}).json()
    assert admin_client.delete(f"/api/v1/admin/categories/{gone['id']}").status_code == 204

    body = {"name": "A", "slug": "a-cat", "sku": "A-CAT", "category_id": gone["id"]}
    created = admin_client.post("/api/v1/admin/products", json=body)
    assert created.status_code == 422
    assert created.json()["error"]["message"] == "Category not found"

    product = admin_client.post(
        "/api/v1/admin/products", json={**body, "category_id": live["id"]}
    ).json()
    moved = admin_client.patch(
        f"/api/v1/admin/products/{product['id']}", json={"category_id": gone["id"]}
    )
    assert moved.status_code == 422
    cleared = admin_client.patch(
        f"/api/v1/admin/products/{product['id']}", json={"category_id": None}
    )
    assert cleared.status_code == 200


def test_hidden_category_hides_its_products_from_every_public_view(
    admin_client: TestClient,
) -> None:
    category = admin_client.post(
        "/api/v1/admin/categories", json={"name": "Ẩn", "slug": "an", "is_visible": True}
    ).json()
    product = admin_client.post(
        "/api/v1/admin/products",
        json={
            "name": "Tủ trong loại ẩn",
            "slug": "tu-loai-an",
            "sku": "TU-LOAI-AN",
            "category_id": category["id"],
            "publish_status": "published",
        },
    ).json()
    admin_client.post(
        "/api/v1/admin/products",
        json={"name": "Tủ không loại", "slug": "tu-khong-loai", "sku": "TU-KHONG-LOAI", "publish_status": "published"},
    )

    def public_slugs(query: str = "") -> list[str]:
        return [p["slug"] for p in admin_client.get(f"/api/v1/products{query}").json()["items"]]

    assert sorted(public_slugs()) == ["tu-khong-loai", "tu-loai-an"]
    admin_client.patch(f"/api/v1/admin/categories/{category['id']}", json={"is_visible": False})

    assert admin_client.get("/api/v1/categories").json() == []
    assert admin_client.get("/api/v1/categories/an").status_code == 404
    assert public_slugs() == ["tu-khong-loai"]  # "Tất cả sản phẩm" and the sitemap source
    assert public_slugs("?search=trong") == []
    assert public_slugs("?category=an") == []
    assert admin_client.get("/api/v1/products/tu-loai-an").status_code == 404
    # The product's own settings are untouched and admins still see and edit it.
    stored = admin_client.get(f"/api/v1/admin/products/{product['id']}").json()
    assert (stored["publish_status"], stored["is_visible"]) == ("published", True)
    assert admin_client.get("/api/v1/admin/dashboard/stats").json()["visible_products"] == 1

    admin_client.patch(f"/api/v1/admin/categories/{category['id']}", json={"is_visible": True})
    assert admin_client.get("/api/v1/products/tu-loai-an").status_code == 200
    assert sorted(public_slugs()) == ["tu-khong-loai", "tu-loai-an"]


def test_published_date_cannot_be_cleared_to_unlock_the_url(admin_client: TestClient) -> None:
    created = admin_client.post(
        "/api/v1/admin/products",
        json={"name": "Đã đăng", "slug": "da-dang", "sku": "DA-DANG", "publish_status": "published"},
    ).json()
    cleared = admin_client.patch(
        f"/api/v1/admin/products/{created['id']}", json={"published_at": None}
    )
    assert cleared.status_code == 409
    assert cleared.json()["error"]["message"] == "Published product URL cannot change"
    both = admin_client.patch(
        f"/api/v1/admin/products/{created['id']}", json={"published_at": None, "slug": "mo-khoa"}
    )
    assert both.status_code == 409
    current = admin_client.get(f"/api/v1/admin/products/{created['id']}").json()
    assert current["slug"] == "da-dang"
    assert current["published_at"] is not None


def test_products_left_in_a_category_deleted_before_the_guard_are_not_public(
    admin_client: TestClient, db: Session
) -> None:
    # Legacy data: categories were soft-deleted without moving their products first.
    category = admin_client.post(
        "/api/v1/admin/categories", json={"name": "Cũ", "slug": "cu-legacy"}
    ).json()
    admin_client.post(
        "/api/v1/admin/products",
        json={
            "name": "Tủ mồ côi",
            "slug": "tu-mo-coi",
            "sku": "TU-MO-COI",
            "category_id": category["id"],
            "publish_status": "published",
        },
    )
    db.execute(
        update(Category)
        .where(Category.id == uuid.UUID(category["id"]))
        .values(deleted_at=datetime.now(UTC), is_visible=False)
    )
    db.commit()

    assert admin_client.get("/api/v1/products").json()["total"] == 0
    assert admin_client.get("/api/v1/products?search=m%E1%BB%93").json()["total"] == 0
    assert admin_client.get("/api/v1/products/tu-mo-coi").status_code == 404
    assert admin_client.get("/api/v1/admin/dashboard/stats").json()["visible_products"] == 0
    assert admin_client.get("/api/v1/admin/products").json()["total"] == 1  # admins can still fix it
