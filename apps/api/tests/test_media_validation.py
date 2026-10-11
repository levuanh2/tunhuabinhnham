import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.v1.admin import _valid_image_signature
from app.models import Banner, MediaAsset


def test_webp_signature_requires_webp_fourcc() -> None:
    assert _valid_image_signature("image/webp", b"RIFF\x00\x00\x00\x00WEBPdata")
    assert not _valid_image_signature("image/webp", b"RIFF\x00\x00\x00\x00AVI data")


def test_icon_signature_is_validated() -> None:
    assert _valid_image_signature("image/x-icon", b"\x00\x00\x01\x00rest")
    assert not _valid_image_signature("image/x-icon", b"not-an-icon")


def test_delete_media_by_url_rejects_referenced_asset(
    admin_client: TestClient, db: Session
) -> None:
    url = "https://example.supabase.co/storage/v1/object/public/banners/banner.webp"
    db.add(
        MediaAsset(
            id=uuid.uuid4(),
            storage_key="banner.webp",
            bucket="banners",
            public_url=url,
            mime_type="image/webp",
            size_bytes=100,
        )
    )
    db.add(Banner(title="Banner", image_url=url, sort_order=0, is_active=True))
    db.commit()

    response = admin_client.delete("/api/v1/admin/media", params={"url": url})

    assert response.status_code == 409
    assert response.json()["error"]["message"] == "Media is still referenced by content"


def test_delete_media_by_url_returns_not_found(admin_client: TestClient) -> None:
    response = admin_client.delete(
        "/api/v1/admin/media", params={"url": "https://example.com/not-managed.webp"}
    )
    assert response.status_code == 404
