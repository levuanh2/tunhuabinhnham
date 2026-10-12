import uuid

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuditLog, Post, SiteSettings


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


def test_post_update_duplicate_slug_returns_sanitized_conflict_and_rolls_back(
    admin_client: TestClient, db: Session
) -> None:
    first = admin_client.post(
        "/api/v1/admin/posts", json={"title": "First", "slug": "first-post"}
    )
    second = admin_client.post(
        "/api/v1/admin/posts", json={"title": "Second", "slug": "second-post"}
    )
    assert first.status_code == 201
    assert second.status_code == 201

    response = admin_client.patch(
        f"/api/v1/admin/posts/{second.json()['id']}",
        json={"title": "Changed", "slug": "first-post"},
    )

    assert response.status_code == 409
    assert response.json()["error"] == {
        "code": "http_409",
        "message": "Slug already exists",
    }
    assert "UNIQUE" not in response.text
    assert "posts.slug" not in response.text
    db.expire_all()
    stored = db.get(Post, uuid.UUID(second.json()["id"]))
    assert stored is not None
    assert stored.slug == "second-post"
    assert stored.title == "Second"
    failed_audit = db.scalar(
        select(AuditLog).where(
            AuditLog.entity_type == "post",
            AuditLog.entity_id == stored.id,
            AuditLog.action == "update",
        )
    )
    assert failed_audit is None


def test_post_create_duplicate_slug_returns_sanitized_conflict(
    admin_client: TestClient,
) -> None:
    payload = {"title": "First", "slug": "duplicate-post"}
    assert admin_client.post("/api/v1/admin/posts", json=payload).status_code == 201

    response = admin_client.post(
        "/api/v1/admin/posts", json={"title": "Second", "slug": "duplicate-post"}
    )

    assert response.status_code == 409
    assert response.json()["error"]["message"] == "Slug already exists"


def test_settings_audit_records_changed_before_after_and_redacts_urls(
    admin_client: TestClient, db: Session
) -> None:
    settings = SiteSettings(
        store_name="Old name",
        facebook_url="https://facebook.com/old?access_token=old-secret",
        contact_tracking_enabled=True,
    )
    db.add(settings)
    db.commit()

    response = admin_client.patch(
        "/api/v1/admin/site-settings",
        json={
            "store_name": "Tủ Nhựa Bình Nhâm",
            "facebook_url": "https://facebook.com/new?token=query-secret#fragment-secret",
            "logo_url": "https://user:new-secret@cdn.example.com/logo.png?signature=logo-secret",
            "contact_tracking_enabled": False,
            "about_text": "",
        },
    )

    assert response.status_code == 200, response.text
    audit = db.scalar(
        select(AuditLog).where(AuditLog.entity_type == "site_settings")
    )
    assert audit is not None
    assert audit.changes["store_name"] == {
        "before": "Old name",
        "after": "Tủ Nhựa Bình Nhâm",
    }
    assert audit.changes["contact_tracking_enabled"] == {
        "before": True,
        "after": False,
    }
    assert audit.changes["facebook_url"] == {
        "before": {"present": True, "origin": "https://facebook.com"},
        "after": {"present": True, "origin": "https://facebook.com"},
    }
    assert audit.changes["logo_url"] == {
        "before": None,
        "after": {"present": True, "origin": "https://cdn.example.com"},
    }
    assert "about_text" not in audit.changes
    serialized = str(audit.changes)
    for secret in (
        "old-secret",
        "new-secret",
        "query-secret",
        "fragment-secret",
        "logo-secret",
    ):
        assert secret not in serialized


def test_settings_noop_does_not_create_empty_audit(
    admin_client: TestClient, db: Session
) -> None:
    db.add(SiteSettings(store_name="Same", facebook_url="https://facebook.com"))
    db.commit()

    response = admin_client.patch(
        "/api/v1/admin/site-settings", json={"store_name": "Same"}
    )

    assert response.status_code == 200
    assert db.scalar(select(AuditLog).where(AuditLog.entity_type == "site_settings")) is None


def test_settings_missing_row_creates_meaningful_audit(
    admin_client: TestClient, db: Session
) -> None:
    response = admin_client.patch(
        "/api/v1/admin/site-settings", json={"store_name": "Created settings"}
    )

    assert response.status_code == 200, response.text
    audit = db.scalar(
        select(AuditLog).where(AuditLog.entity_type == "site_settings")
    )
    assert audit is not None
    assert audit.action == "create"
    assert audit.changes["store_name"] == {
        "before": None,
        "after": "Created settings",
    }
    assert audit.changes


def test_settings_rejects_null_for_required_fields(admin_client: TestClient) -> None:
    response = admin_client.patch(
        "/api/v1/admin/site-settings", json={"store_name": None}
    )

    assert response.status_code == 422
