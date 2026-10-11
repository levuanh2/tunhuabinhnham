from __future__ import annotations

import base64
import os
import secrets
import time
import uuid
from typing import cast

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool
from supabase import Client, create_client

from app.core.config import get_settings
from app.main import app

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII="
)
ICO = b"\x00\x00\x01\x00" + b"\x00" * 32
BUCKETS = ("product-images", "post-images", "banners", "branding")


def _required() -> None:
    if os.getenv("RUN_LIVE_SUPABASE_WRITE_TESTS") != "true":
        pytest.skip("live Supabase writes require explicit opt-in")
    settings = get_settings()
    if not all(
        (
            settings.database_url.startswith("postgresql"),
            settings.supabase_url,
            settings.supabase_publishable_key,
            settings.supabase_secret_key,
        )
    ):
        pytest.skip("live Supabase credentials are not configured")


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.integration_supabase
def test_live_auth_rls_storage_and_cms_workflow() -> None:
    """Run destructive-safe synthetic integration checks and clean up this run only."""
    _required()
    settings = get_settings()
    run_id = f"__e2e_{int(time.time())}_{secrets.token_hex(3)}"
    password = f"GateB-{secrets.token_urlsafe(18)}-9a!"
    admin_email = f"{run_id}_admin@example.invalid"
    user_email = f"{run_id}_user@example.invalid"
    service: Client = create_client(settings.supabase_url, settings.supabase_secret_key)
    public: Client = create_client(settings.supabase_url, settings.supabase_publishable_key)
    engine = create_engine(
        settings.database_url,
        poolclass=NullPool,
        connect_args={"connect_timeout": 5, "sslmode": "require"},
    )

    auth_user_ids: list[str] = []
    storage_objects: list[tuple[str, str]] = []
    admin_id: str | None = None
    category_id: str | None = None
    product_id: str | None = None
    post_id: str | None = None
    banner_id: str | None = None

    def upload(client: TestClient, token: str, bucket: str, name: str, body: bytes = PNG) -> dict[str, str]:
        response = client.post(
            f"/api/v1/admin/media?bucket={bucket}",
            headers=_auth_headers(token),
            files={"file": (name, body, "image/x-icon" if name.endswith(".ico") else "image/png")},
        )
        assert response.status_code == 201, response.text
        result = cast(dict[str, str], response.json())
        storage_objects.append((bucket, result["storage_key"]))
        return result

    try:
        admin_user = service.auth.admin.create_user(
            {"email": admin_email, "password": password, "email_confirm": True}
        ).user
        normal_user = service.auth.admin.create_user(
            {"email": user_email, "password": password, "email_confirm": True}
        ).user
        assert admin_user is not None and normal_user is not None
        auth_user_ids.extend((str(admin_user.id), str(normal_user.id)))

        admin_id = str(uuid.uuid4())
        with engine.begin() as connection:
            connection.execute(
                text(
                    "insert into public.admin_users "
                    "(id, auth_user_id, email, role, is_active) "
                    "values (:id, :auth_user_id, :email, 'admin', true)"
                ),
                {"id": admin_id, "auth_user_id": str(admin_user.id), "email": admin_email},
            )

        admin_session = public.auth.sign_in_with_password(
            {"email": admin_email, "password": password}
        ).session
        user_session = public.auth.sign_in_with_password(
            {"email": user_email, "password": password}
        ).session
        assert admin_session is not None and user_session is not None
        admin_token = admin_session.access_token
        user_token = user_session.access_token

        refreshed = public.auth.refresh_session(user_session.refresh_token).session
        assert refreshed is not None and refreshed.access_token

        with TestClient(app, raise_server_exceptions=False) as client:
            assert client.get("/api/v1/admin/categories").status_code == 401
            assert client.get(
                "/api/v1/admin/categories", headers=_auth_headers(user_token)
            ).status_code == 403
            assert client.get(
                "/api/v1/admin/categories", headers=_auth_headers(admin_token + "x")
            ).status_code == 401
            me = client.get("/api/v1/auth/me", headers=_auth_headers(admin_token))
            assert me.status_code == 200 and me.json()["role"] == "admin"

            allowed = client.options(
                "/api/v1/admin/categories",
                headers={
                    "Origin": "http://localhost:3000",
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "authorization,content-type",
                },
            )
            assert allowed.status_code == 200
            assert allowed.headers["access-control-allow-origin"] == "http://localhost:3000"
            denied = client.options(
                "/api/v1/admin/categories",
                headers={"Origin": "https://evil.invalid", "Access-Control-Request-Method": "POST"},
            )
            assert denied.status_code == 400
            assert "access-control-allow-origin" not in denied.headers

            rest_url = f"{settings.supabase_url.rstrip('/')}/rest/v1/categories"
            anon_headers = {"apikey": settings.supabase_publishable_key}
            assert httpx.get(rest_url, headers=anon_headers, timeout=10).status_code == 200
            anon_write = httpx.post(
                rest_url,
                headers={**anon_headers, "Content-Type": "application/json"},
                json={"name": run_id, "slug": run_id.strip("_").replace("_", "-")},
                timeout=10,
            )
            assert anon_write.status_code in {401, 403}
            user_write = httpx.post(
                rest_url,
                headers={
                    **anon_headers,
                    "Authorization": f"Bearer {user_token}",
                    "Content-Type": "application/json",
                },
                json={"name": run_id, "slug": run_id.strip("_").replace("_", "-")},
                timeout=10,
            )
            assert user_write.status_code in {401, 403}

            unauthorized_key = f"{run_id}/unauthorized.png"
            storage_url = (
                f"{settings.supabase_url.rstrip('/')}/storage/v1/object/product-images/"
                f"{unauthorized_key}"
            )
            for headers in (
                anon_headers,
                {**anon_headers, "Authorization": f"Bearer {user_token}"},
            ):
                result = httpx.post(
                    storage_url,
                    headers={**headers, "Content-Type": "image/png"},
                    content=PNG,
                    timeout=10,
                )
                assert result.status_code in {400, 401, 403}

            invalid = client.post(
                "/api/v1/admin/media?bucket=product-images",
                headers=_auth_headers(admin_token),
                files={"file": ("fake.png", b"not-an-image", "image/png")},
            )
            assert invalid.status_code == 415

            product_media = [
                upload(client, admin_token, "product-images", f"{run_id}-1.png"),
                upload(client, admin_token, "product-images", f"{run_id}-2.png"),
            ]
            category = client.post(
                "/api/v1/admin/categories",
                headers=_auth_headers(admin_token),
                json={
                    "name": run_id,
                    "slug": run_id.strip("_").replace("_", "-"),
                    "is_visible": True,
                },
            )
            assert category.status_code == 201, category.text
            category_id = category.json()["id"]
            slug = f"{run_id.strip('_').replace('_', '-')}-product"
            product = client.post(
                "/api/v1/admin/products",
                headers=_auth_headers(admin_token),
                json={
                    "name": f"{run_id} product",
                    "slug": slug,
                    "sku": f"E2E-{run_id.split('_')[-1]}",
                    "category_id": category_id,
                    "publish_status": "published",
                    "is_visible": True,
                    "images": [
                        {
                            "storage_key": item["storage_key"],
                            "url": item["url"],
                            "sort_order": index,
                            "is_primary": index == 0,
                        }
                        for index, item in enumerate(product_media)
                    ],
                },
            )
            assert product.status_code == 201, product.text
            product_id = product.json()["id"]
            public_product = client.get(f"/api/v1/products/{slug}")
            assert public_product.status_code == 200
            assert len(public_product.json()["images"]) == 2
            rls_product = httpx.get(
                f"{settings.supabase_url.rstrip('/')}/rest/v1/products",
                headers=anon_headers,
                params={"slug": f"eq.{slug}", "select": "slug"},
                timeout=10,
            )
            assert rls_product.status_code == 200 and len(rls_product.json()) == 1

            updated = client.patch(
                f"/api/v1/admin/products/{product_id}",
                headers=_auth_headers(admin_token),
                json={"description": f"{run_id} updated"},
            )
            assert updated.status_code == 200
            assert client.get(f"/api/v1/products/{slug}").json()["description"].endswith("updated")
            hidden = client.patch(
                f"/api/v1/admin/products/{product_id}",
                headers=_auth_headers(admin_token),
                json={"is_visible": False},
            )
            assert hidden.status_code == 200
            assert client.get(f"/api/v1/products/{slug}").status_code == 404

            post_media = upload(client, admin_token, "post-images", f"{run_id}-post.png")
            post_slug = f"{run_id.strip('_').replace('_', '-')}-post"
            post = client.post(
                "/api/v1/admin/posts",
                headers=_auth_headers(admin_token),
                json={
                    "title": f"{run_id} post",
                    "slug": post_slug,
                    "content_html": "<p>Synthetic Gate B content</p>",
                    "cover_image_url": post_media["url"],
                    "publish_status": "published",
                    "images": [{
                        "storage_key": post_media["storage_key"],
                        "url": post_media["url"],
                        "sort_order": 0,
                    }],
                },
            )
            assert post.status_code == 201, post.text
            post_id = post.json()["id"]
            assert client.get(f"/api/v1/posts/{post_slug}").status_code == 200

            banner_media = upload(client, admin_token, "banners", f"{run_id}-banner.png")
            banner = client.post(
                "/api/v1/admin/banners",
                headers=_auth_headers(admin_token),
                json={
                    "title": f"{run_id} banner",
                    "image_url": banner_media["url"],
                    "is_active": True,
                    "sort_order": 9999,
                },
            )
            assert banner.status_code == 201, banner.text
            banner_id = banner.json()["id"]
            assert any(item["id"] == banner_id for item in client.get("/api/v1/banners").json())

            logo = upload(client, admin_token, "branding", f"{run_id}-logo.png")
            favicon = upload(client, admin_token, "branding", f"{run_id}-favicon.ico", ICO)
            for media in (*product_media, post_media, banner_media, logo, favicon):
                download = httpx.get(media["url"], timeout=10)
                assert download.status_code == 200
            delete_denied = httpx.delete(
                f"{settings.supabase_url.rstrip('/')}/storage/v1/object/branding/{logo['storage_key']}",
                headers={**anon_headers, "Authorization": f"Bearer {user_token}"},
                timeout=10,
            )
            assert delete_denied.status_code in {400, 401, 403}
    finally:
        try:
            with engine.begin() as connection:
                if admin_id:
                    connection.execute(
                        text("delete from public.audit_logs where admin_user_id=:id"), {"id": admin_id}
                    )
                if product_id:
                    connection.execute(text("delete from public.products where id=:id"), {"id": product_id})
                if post_id:
                    connection.execute(text("delete from public.posts where id=:id"), {"id": post_id})
                if banner_id:
                    connection.execute(text("delete from public.banners where id=:id"), {"id": banner_id})
                if category_id:
                    connection.execute(text("delete from public.categories where id=:id"), {"id": category_id})
                if admin_id:
                    connection.execute(
                        text("delete from public.media_assets where uploaded_by=:id"), {"id": admin_id}
                    )
                    connection.execute(
                        text("delete from public.admin_users where id=:id"), {"id": admin_id}
                    )
            for bucket, key in storage_objects:
                service.storage.from_(bucket).remove([key])
            for user_id in reversed(auth_user_ids):
                service.auth.admin.delete_user(user_id)
        finally:
            engine.dispose()
