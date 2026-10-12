from fastapi.testclient import TestClient


def test_post_images_are_created_and_reconciled(admin_client: TestClient) -> None:
    image = {
        "storage_key": "2026/10/article.webp",
        "url": "https://example.supabase.co/storage/v1/object/public/post-images/2026/10/article.webp",
        "alt_text": "Ảnh bài viết",
        "sort_order": 0,
    }
    created = admin_client.post(
        "/api/v1/admin/posts",
        json={
            "title": "Bài viết",
            "slug": "bai-viet",
            "content_html": "<p>Nội dung</p>",
            "images": [image],
        },
    )
    assert created.status_code == 201, created.text
    post_id = created.json()["id"]

    image["alt_text"] = "Ảnh đã cập nhật"
    updated = admin_client.patch(f"/api/v1/admin/posts/{post_id}", json={"images": [image]})

    assert updated.status_code == 200, updated.text
    assert updated.json()["images"][0]["storage_key"] == image["storage_key"]
    assert updated.json()["images"][0]["alt_text"] == "Ảnh đã cập nhật"


def test_post_image_sort_order_must_be_unique(admin_client: TestClient) -> None:
    response = admin_client.post(
        "/api/v1/admin/posts",
        json={
            "title": "Bài viết",
            "slug": "bai-viet",
            "images": [
                {"storage_key": "a", "url": "https://example.com/a", "sort_order": 0},
                {"storage_key": "b", "url": "https://example.com/b", "sort_order": 0},
            ],
        },
    )
    assert response.status_code == 422


def test_post_update_swaps_existing_image_order(admin_client: TestClient) -> None:
    first = {
        "storage_key": "2026/10/post-first.webp",
        "url": "https://example.com/post-first.webp",
        "alt_text": "First",
        "sort_order": 0,
    }
    second = {
        "storage_key": "2026/10/post-second.webp",
        "url": "https://example.com/post-second.webp",
        "alt_text": "Second",
        "sort_order": 1,
    }
    created = admin_client.post(
        "/api/v1/admin/posts",
        json={
            "title": "Reorderable post",
            "slug": "reorderable-post",
            "images": [first, second],
        },
    )
    assert created.status_code == 201, created.text

    first["sort_order"] = 1
    second["sort_order"] = 0
    updated = admin_client.patch(
        f"/api/v1/admin/posts/{created.json()['id']}",
        json={"images": [second, first]},
    )

    assert updated.status_code == 200, updated.text
    images = {image["storage_key"]: image for image in updated.json()["images"]}
    assert images[first["storage_key"]]["sort_order"] == 1
    assert images[second["storage_key"]]["sort_order"] == 0
