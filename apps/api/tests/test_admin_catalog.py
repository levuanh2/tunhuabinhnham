from fastapi.testclient import TestClient


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
