"""V1-BUG-01: content must never reference a media object that has been deleted."""

import sys
import types
import uuid
from collections.abc import Generator
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.main import app
from app.models import AuditLog, MediaAsset, Product

BASE = "https://example.supabase.co/storage/v1/object/public"


def asset(
    db: Session, name: str, bucket: str = "product-images", deleted: bool = False
) -> MediaAsset:
    item = MediaAsset(
        id=uuid.uuid4(),
        storage_key=f"2026/10/{name}",
        bucket=bucket,
        public_url=f"{BASE}/{bucket}/2026/10/{name}",
        mime_type="image/png",
        size_bytes=100,
        deleted_at=datetime.now(UTC) if deleted else None,
    )
    db.add(item)
    db.commit()
    return item


def image(item: MediaAsset, order: int = 0) -> dict[str, object]:
    return {
        "storage_key": item.storage_key,
        "url": item.public_url,
        "sort_order": order,
        "is_primary": order == 0,
    }


def product_body(*images: dict[str, object]) -> dict[str, object]:
    return {
        "name": "Tủ",
        "slug": f"tu-{uuid.uuid4().hex[:6]}",
        "sku": uuid.uuid4().hex[:8],
        "images": list(images),
    }


@pytest.fixture
def storage(
    monkeypatch: pytest.MonkeyPatch, db: Session
) -> Generator[dict[str, object], None, None]:
    """A fake Supabase Storage client; `state["fail"]` makes remove() raise."""
    state: dict[str, object] = {"fail": False, "removed": [], "open_transaction": []}

    class Bucket:
        def remove(self, keys: list[str]) -> None:
            # The route shares `db`: no open transaction means the deletion was committed.
            state["open_transaction"].append(db.in_transaction())  # type: ignore[union-attr]
            if state["fail"]:
                raise RuntimeError("storage down")
            state["removed"].extend(keys)  # type: ignore[union-attr]

    client = types.SimpleNamespace(storage=types.SimpleNamespace(from_=lambda _bucket: Bucket()))
    monkeypatch.setitem(
        sys.modules, "supabase", types.SimpleNamespace(create_client=lambda *_: client)
    )
    settings = get_settings().model_copy(
        update={"supabase_url": "https://example.supabase.co", "supabase_secret_key": "test"}
    )
    app.dependency_overrides[get_settings] = lambda: settings
    yield state
    app.dependency_overrides.pop(get_settings, None)


def test_saving_a_product_with_a_deleted_image_is_rejected(
    admin_client: TestClient, db: Session
) -> None:
    kept, removed = asset(db, "kept.png"), asset(db, "removed.png", deleted=True)
    response = admin_client.post(
        "/api/v1/admin/products", json=product_body(image(kept), image(removed, 1))
    )
    assert response.status_code == 422
    assert response.json()["error"]["message"] == "Image was deleted"
    assert db.scalar(select(Product)) is None


def test_live_and_unmanaged_images_are_accepted(admin_client: TestClient, db: Session) -> None:
    live = asset(db, "live.png")
    seed = {
        "storage_key": "seed/legacy.png",
        "url": f"{BASE}/product-images/seed/legacy.png",
        "sort_order": 1,
    }
    created = admin_client.post("/api/v1/admin/products", json=product_body(image(live), seed))
    assert created.status_code == 201, created.text
    gone = asset(db, "gone.png", deleted=True)
    patched = admin_client.patch(
        f"/api/v1/admin/products/{created.json()['id']}",
        json={"images": [image(live), image(gone, 1)]},
    )
    assert patched.status_code == 422
    db.expire_all()
    assert [i.storage_key for i in db.scalar(select(Product)).images] == [
        live.storage_key,
        "seed/legacy.png",
    ]  # type: ignore[union-attr]


@pytest.mark.parametrize(
    ("path", "field", "bucket", "method"),
    [
        ("/api/v1/admin/posts", "cover_image_url", "post-images", "post"),
        ("/api/v1/admin/banners", "image_url", "banners", "post"),
        ("/api/v1/admin/site-settings", "logo_url", "branding", "patch"),
    ],
)
def test_other_content_cannot_reference_a_deleted_image(
    admin_client: TestClient, db: Session, path: str, field: str, bucket: str, method: str
) -> None:
    gone = asset(db, f"gone-{field}.png", bucket=bucket, deleted=True)
    body: dict[str, object] = {
        "/api/v1/admin/posts": {"title": "Bài", "slug": "bai"},
        "/api/v1/admin/banners": {"title": "Banner"},
        "/api/v1/admin/site-settings": {},
    }[path]
    response = getattr(admin_client, method)(path, json={**body, field: gone.public_url})
    assert response.status_code == 422, response.text


def test_delete_marks_the_asset_deleted_before_removing_the_object(
    admin_client: TestClient, db: Session, storage: dict[str, object]
) -> None:
    item = asset(db, "drop.png")
    assert admin_client.delete(f"/api/v1/admin/media/{item.id}").status_code == 204
    assert storage["removed"] == [item.storage_key]
    # deleted_at was committed before the object was removed.
    assert storage["open_transaction"] == [False]
    db.expire_all()
    assert db.get(MediaAsset, item.id).deleted_at is not None  # type: ignore[union-attr]
    # So a save that arrives after the delete cannot reference it.
    response = admin_client.post("/api/v1/admin/products", json=product_body(image(item)))
    assert response.status_code == 422


def test_failed_storage_delete_leaves_the_asset_usable_and_retryable(
    admin_client: TestClient, db: Session, storage: dict[str, object]
) -> None:
    item = asset(db, "stuck.png")
    storage["fail"] = True
    response = admin_client.delete(f"/api/v1/admin/media/{item.id}")
    assert response.status_code == 502
    db.expire_all()
    assert db.get(MediaAsset, item.id).deleted_at is None  # type: ignore[union-attr]
    actions = db.scalars(select(AuditLog.action).where(AuditLog.entity_id == item.id)).all()
    assert sorted(actions) == ["delete", "restore"]
    # The object still exists, so the image can still be saved, and the delete retried.
    assert (
        admin_client.post("/api/v1/admin/products", json=product_body(image(item))).status_code
        == 201
    )
    storage["fail"] = False
    assert (
        admin_client.delete(f"/api/v1/admin/media/{item.id}").status_code == 409
    )  # now referenced
