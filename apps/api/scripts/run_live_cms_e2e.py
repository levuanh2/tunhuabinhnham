"""Run the real local CMS browser workflow against the approved Supabase project."""

from __future__ import annotations

import os
import secrets
import subprocess
import sys
import time
import uuid
from pathlib import Path

import httpx
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool
from supabase import Client, create_client

from app.core.config import get_settings

ROOT = Path(__file__).resolve().parents[3]


def _wait_for(url: str, timeout: float = 90) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if httpx.get(url, timeout=2).status_code < 500:
                return
        except httpx.HTTPError:
            pass
        time.sleep(1)
    raise RuntimeError(f"Timed out waiting for local service: {url}")


def _is_ready(url: str) -> bool:
    try:
        return httpx.get(url, timeout=2).status_code < 500
    except httpx.HTTPError:
        return False


def _stop_tree(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    else:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()


def main() -> int:
    if os.getenv("RUN_LIVE_CMS_E2E") != "true":
        raise SystemExit("Set RUN_LIVE_CMS_E2E=true to authorize synthetic live writes")
    settings = get_settings()
    if not settings.supabase_secret_key:
        raise SystemExit("Supabase server secret key is not configured")

    run_id = f"{int(time.time())}-{secrets.token_hex(3)}"
    record_prefix = f"__e2e_{run_id}_"
    slug_prefix = f"e2e-{run_id}-"
    email = f"{record_prefix}admin@example.invalid"
    password = f"GateB-{secrets.token_urlsafe(18)}-7x!"
    service: Client = create_client(settings.supabase_url, settings.supabase_secret_key)
    public: Client = create_client(settings.supabase_url, settings.supabase_publishable_key)
    engine = create_engine(
        settings.database_url,
        poolclass=NullPool,
        connect_args={"connect_timeout": 5, "sslmode": "require"},
    )
    admin_id = str(uuid.uuid4())
    auth_user_id: str | None = None
    processes: list[subprocess.Popen[bytes]] = []
    assets: list[tuple[object, object]] = []
    settings_snapshot = None
    banner_snapshot = []

    try:
        with engine.connect() as connection:
            settings_snapshot = connection.execute(
                text(
                    "select id, store_name, logo_url, favicon_url, facebook_url, "
                    "messenger_url, hotline, address, about_text, default_seo_title, "
                    "default_seo_description, contact_tracking_enabled "
                    "from public.site_settings limit 1"
                )
            ).mappings().first()
            banner_snapshot = list(
                connection.execute(
                    text("select id, sort_order, is_active from public.banners")
                ).mappings()
            )
        user = service.auth.admin.create_user(
            {"email": email, "password": password, "email_confirm": True}
        ).user
        if user is None:
            raise RuntimeError("Synthetic Auth user was not created")
        auth_user_id = str(user.id)
        session = public.auth.sign_in_with_password(
            {"email": email, "password": password}
        ).session
        if session is None:
            raise RuntimeError("Synthetic admin session was not created")
        with engine.begin() as connection:
            connection.execute(
                text(
                    "insert into public.admin_users "
                    "(id, auth_user_id, email, role, is_active) "
                    "values (:id, :auth_user_id, :email, 'admin', true)"
                ),
                {"id": admin_id, "auth_user_id": auth_user_id, "email": email},
            )

        if not _is_ready("http://127.0.0.1:8000/health/ready"):
            api = subprocess.Popen(
                [
                    str(ROOT / ".venv" / "Scripts" / "python.exe"),
                    "-m",
                    "uvicorn",
                    "app.main:app",
                    "--app-dir",
                    "apps/api",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    "8000",
                ],
                cwd=ROOT,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            processes.append(api)
        if not _is_ready("http://localhost:3000/admin/login"):
            npm = "npm.cmd" if os.name == "nt" else "npm"
            web = subprocess.Popen(
                [npm, "--workspace", "apps/web", "run", "dev"],
                cwd=ROOT,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            processes.append(web)
        _wait_for("http://127.0.0.1:8000/health/ready")
        _wait_for("http://localhost:3000/admin/login")

        env = os.environ.copy()
        env.update(
            {
                "E2E_ALLOW_STAGING_WRITES": "true",
                "E2E_BASE_URL": "http://localhost:3000",
                "E2E_API_URL": "http://127.0.0.1:8000/api/v1",
                "E2E_ADMIN_EMAIL": email,
                "E2E_ADMIN_PASSWORD": password,
                "E2E_ADMIN_ACCESS_TOKEN": session.access_token,
                "E2E_RUN_ID": run_id,
            }
        )
        completed = subprocess.run(
            [
                str(ROOT / "node_modules" / ".bin" / "playwright.cmd"),
                "test",
                "e2e/staging-cms.spec.ts",
                "--project=desktop",
                "--reporter=line",
            ],
            cwd=ROOT / "apps" / "web",
            env=env,
            check=False,
        )
        return completed.returncode
    finally:
        for process in reversed(processes):
            _stop_tree(process)
        try:
            with engine.begin() as connection:
                if settings_snapshot is not None:
                    connection.execute(
                        text(
                            "update public.site_settings set store_name=:store_name, "
                            "logo_url=:logo_url, favicon_url=:favicon_url, "
                            "facebook_url=:facebook_url, messenger_url=:messenger_url, "
                            "hotline=:hotline, address=:address, about_text=:about_text, "
                            "default_seo_title=:default_seo_title, "
                            "default_seo_description=:default_seo_description, "
                            "contact_tracking_enabled=:contact_tracking_enabled "
                            "where id=:id"
                        ),
                        dict(settings_snapshot),
                    )
                for banner in banner_snapshot:
                    connection.execute(
                        text(
                            "update public.banners set sort_order=:sort_order, "
                            "is_active=:is_active where id=:id"
                        ),
                        dict(banner),
                    )
                assets = list(
                    connection.execute(
                        text(
                            "select bucket, storage_key from public.media_assets "
                            "where uploaded_by=:admin_id"
                        ),
                        {"admin_id": admin_id},
                    ).all()
                )
                connection.execute(
                    text("delete from public.audit_logs where admin_user_id=:admin_id"),
                    {"admin_id": admin_id},
                )
                connection.execute(
                    text(
                        "delete from public.contact_clicks where product_id in "
                        "(select id from public.products where slug like :prefix)"
                    ),
                    {"prefix": f"{slug_prefix}%"},
                )
                connection.execute(
                    text("delete from public.products where slug like :prefix"),
                    {"prefix": f"{slug_prefix}%"},
                )
                connection.execute(
                    text("delete from public.posts where slug like :prefix"),
                    {"prefix": f"{slug_prefix}%"},
                )
                connection.execute(
                    text("delete from public.banners where title like :prefix"),
                    {"prefix": f"{record_prefix}%"},
                )
                connection.execute(
                    text("delete from public.categories where slug like :prefix"),
                    {"prefix": f"{slug_prefix}%"},
                )
                connection.execute(
                    text("delete from public.media_assets where uploaded_by=:admin_id"),
                    {"admin_id": admin_id},
                )
                connection.execute(
                    text("delete from public.admin_users where id=:admin_id"),
                    {"admin_id": admin_id},
                )
            for bucket, storage_key in assets:
                service.storage.from_(str(bucket)).remove([str(storage_key)])
            if auth_user_id:
                service.auth.admin.delete_user(auth_user_id)
        finally:
            engine.dispose()


if __name__ == "__main__":
    sys.exit(main())
