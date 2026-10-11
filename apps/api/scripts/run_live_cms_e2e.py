"""Gate C1 live CMS E2E harness for the approved Supabase project.

Safety model
- Opt-in only: RUN_LIVE_CMS_E2E=true. `--dry-run` performs identity/baseline/server checks and
  writes nothing to Supabase.
- Secrets are read from E2E_SECRETS_ENV_FILE (the backend .env) and passed to child processes via
  their environment only. They are never printed or written to disk by this script.
- The project-ref fingerprint must equal E2E_EXPECTED_REF_FINGERPRINT.
- A baseline of row ids, Auth user ids and Storage objects is captured before any write. Cleanup
  deletes only ids absent from that baseline AND attributable to this run (synthetic admin id,
  run prefixes or the manifest). Pre-existing rows, the permanent admin and the canonical
  `site_settings.store_name` are never deleted or reverted.
- Every created/discovered id is appended to an external JSONL manifest under E2E_BACKUP_ROOT.
- The run ends with a full baseline diff; any unexpected difference fails the run.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import secrets
import socket
import subprocess
import sys
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import Connection, Engine, create_engine, text
from sqlalchemy.pool import NullPool
from supabase import Client, create_client

ROOT = Path(__file__).resolve().parents[3]
TABLES = (
    "admin_users", "audit_logs", "banners", "categories", "contact_clicks", "media_assets",
    "posts", "post_images", "product_images", "products", "site_settings",
)
SETTINGS_FIELDS = (
    "logo_url", "favicon_url", "facebook_url", "messenger_url", "hotline", "address",
    "about_text", "default_seo_title", "default_seo_description", "contact_tracking_enabled",
)


def _load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def _db_url(raw: str) -> str:
    return re.sub(r"^postgresql(\+psycopg)?://", "postgresql+psycopg://", raw)


def _fingerprint(supabase_url: str) -> str:
    match = re.fullmatch(r"https://([a-z0-9]+)\.supabase\.co/?", supabase_url.strip())
    if not match:
        raise SystemExit("SUPABASE_URL is not a hosted Supabase project URL")
    return hashlib.sha256(match.group(1).encode()).hexdigest()[:12]


def _port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        return sock.connect_ex(("127.0.0.1", port)) != 0


def _wait_for(url: str, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if httpx.get(url, timeout=5).status_code < 500:
                return
        except httpx.HTTPError:
            pass
        time.sleep(2)
    raise RuntimeError(f"Timed out waiting for {url}")


def _stop_tree(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    else:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()


def _ids(connection: Connection, sql: str, params: dict[str, Any] | None = None) -> list[str]:
    values: list[Any] = list(connection.execute(text(sql), params or {}).scalars().all())
    return [str(value) for value in values]


class Manifest:
    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=False)

    def add(self, kind: str, **data: Any) -> None:
        entry = {"at": datetime.now(UTC).isoformat(), "kind": kind, **data}
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False, default=str) + "\n")


def snapshot(engine: Engine) -> dict[str, Any]:
    """Read-only inventory of ids, counts, managed rows and the settings row."""
    with engine.connect() as connection:
        connection.execute(text("set transaction read only"))
        snap: dict[str, Any] = {
            "revision": connection.execute(text("select version_num from public.alembic_version")).scalars().all(),
            "ids": {t: sorted(_ids(connection, f"select id from public.{t}")) for t in TABLES},
            "auth_users": sorted(_ids(connection, "select id from auth.users")),
            "storage_objects": sorted(f"{b}/{n}" for b, n in connection.execute(text("select bucket_id, name from storage.objects")).all()),
        }
        row = connection.execute(text("select * from public.site_settings limit 1")).mappings().first()
        snap["site_settings"] = {k: (str(v) if v is not None else None) for k, v in (row or {}).items()}
        snap["banners"] = [dict(r) for r in connection.execute(text("select id::text, sort_order, is_active from public.banners")).mappings()]
    snap["counts"] = {t: len(ids) for t, ids in snap["ids"].items()}
    return snap


def diff_baseline(before: dict[str, Any], after: dict[str, Any]) -> list[str]:
    problems: list[str] = []
    for table in TABLES:
        if before["ids"][table] != after["ids"][table]:
            problems.append(f"{table}: ids differ (+{len(set(after['ids'][table]) - set(before['ids'][table]))} / -{len(set(before['ids'][table]) - set(after['ids'][table]))})")
    if before["auth_users"] != after["auth_users"]:
        problems.append("auth.users ids differ")
    if before["storage_objects"] != after["storage_objects"]:
        problems.append(f"storage.objects differ ({len(after['storage_objects'])} vs {len(before['storage_objects'])})")
    for key, value in before["site_settings"].items():
        if key not in {"store_name", "updated_at"} and after["site_settings"].get(key) != value:
            problems.append(f"site_settings.{key} changed")
    if before["revision"] != after["revision"]:
        problems.append("alembic revision changed")
    return problems


def cleanup(engine: Engine, service: Client, baseline: dict[str, Any], manifest: Manifest,
            admin_id: str | None, auth_user_ids: list[str], record_prefix: str, slug_prefix: str) -> None:
    """Delete only rows created by this run; restore settings except store_name."""
    base = {t: set(ids) for t, ids in baseline["ids"].items()}

    def escape(value: str) -> str:
        return value.replace("!", "!!").replace("%", "!%").replace("_", "!_")

    like_name, like_slug = f"{escape(record_prefix)}%", f"{escape(slug_prefix)}%"
    with engine.begin() as connection:
        found: dict[str, list[str]] = {
            "products": _ids(connection, "select id from public.products where slug like :s escape '!' or name like :n escape '!'", {"s": like_slug, "n": like_name}),
            "posts": _ids(connection, "select id from public.posts where slug like :s escape '!' or title like :n escape '!'", {"s": like_slug, "n": like_name}),
            "banners": _ids(connection, "select id from public.banners where title like :n escape '!'", {"n": like_name}),
            "categories": _ids(connection, "select id from public.categories where slug like :s escape '!' or name like :n escape '!'", {"s": like_slug, "n": like_name}),
            "media_assets": _ids(connection, "select id from public.media_assets where uploaded_by = cast(:a as uuid)", {"a": admin_id}) if admin_id else [],
            "audit_logs": _ids(connection, "select id from public.audit_logs where admin_user_id = cast(:a as uuid)", {"a": admin_id}) if admin_id else [],
        }
        found["contact_clicks"] = _ids(connection, "select id from public.contact_clicks where product_id = any(cast(:p as uuid[]))", {"p": found["products"]})
        objects = [(str(b), str(k)) for b, k in connection.execute(
            text("select bucket, storage_key from public.media_assets where id = any(cast(:m as uuid[]))"), {"m": found["media_assets"]}).all()]
        for table, ids in found.items():
            protected = set(ids) & base[table]
            if protected:
                raise RuntimeError(f"Refusing cleanup: {table} contains pre-existing ids")
            for item in ids:
                manifest.add("discovered", table=table, id=item)
        # Settings: restore every snapshot field except the canonical store_name.
        settings = baseline["site_settings"]
        if settings.get("id"):
            assignments = ", ".join(f"{field} = :{field}" for field in SETTINGS_FIELDS)
            params: dict[str, Any] = {f: settings.get(f) for f in SETTINGS_FIELDS}
            params["contact_tracking_enabled"] = settings.get("contact_tracking_enabled") == "True"
            params["id"] = settings["id"]
            connection.execute(text(f"update public.site_settings set {assignments} where id = cast(:id as uuid)"), params)
        for banner in baseline["banners"]:
            connection.execute(text("update public.banners set sort_order=:sort_order, is_active=:is_active where id = cast(:id as uuid)"), banner)
        for table in ("contact_clicks", "audit_logs", "products", "posts", "banners", "categories", "media_assets"):
            if found[table]:
                connection.execute(text(f"delete from public.{table} where id = any(cast(:ids as uuid[]))"), {"ids": found[table]})
        if admin_id and admin_id not in base["admin_users"]:
            connection.execute(text("delete from public.admin_users where id = cast(:a as uuid)"), {"a": admin_id})
    for bucket, key in objects:
        if f"{bucket}/{key}" not in baseline["storage_objects"]:
            service.storage.from_(bucket).remove([key])
            manifest.add("deleted_object", bucket=bucket, key=key)



def main() -> int:
    parser = argparse.ArgumentParser(description="Gate C1 live CMS E2E harness")
    parser.add_argument("--dry-run", action="store_true", help="identity, baseline and server checks only; no Supabase writes")
    args = parser.parse_args()
    if os.getenv("RUN_LIVE_CMS_E2E") != "true":
        raise SystemExit("Set RUN_LIVE_CMS_E2E=true to run the live harness")
    secrets_file = Path(os.environ.get("E2E_SECRETS_ENV_FILE", ""))
    if not secrets_file.is_file():
        raise SystemExit("E2E_SECRETS_ENV_FILE must point to the backend .env file")
    env_values = _load_env_file(secrets_file)
    supabase_url = env_values.get("SUPABASE_URL", "")
    publishable = env_values.get("SUPABASE_PUBLISHABLE_KEY") or env_values.get("SUPABASE_ANON_KEY", "")
    secret_key = env_values.get("SUPABASE_SECRET_KEY") or env_values.get("SUPABASE_SERVICE_ROLE_KEY", "")
    database_url = _db_url(env_values.get("DATABASE_URL", ""))
    expected = os.environ.get("E2E_EXPECTED_REF_FINGERPRINT", "")
    if not (supabase_url and publishable and secret_key and database_url.startswith("postgresql")):
        raise SystemExit("Backend .env is missing Supabase or PostgreSQL settings")
    if not expected or _fingerprint(supabase_url) != expected:
        raise SystemExit("Project fingerprint does not match E2E_EXPECTED_REF_FINGERPRINT")

    web_port = int(os.environ.get("E2E_WEB_PORT", "3200"))
    api_port = int(os.environ.get("E2E_API_PORT", "8200"))
    for port in (web_port, api_port):
        if not _port_free(port):
            raise SystemExit(f"Port {port} is in use; refusing to reuse an unknown server")
    projects = [p for p in os.environ.get("E2E_PROJECTS", "desktop,mobile").split(",") if p]
    run_id = f"gc-{datetime.now(UTC):%Y%m%dT%H%M%SZ}-{secrets.token_hex(3)}"
    record_prefix, slug_prefix = f"__e2e_{run_id}_", f"e2e-{run_id}-"
    run_dir = Path(os.environ.get("E2E_BACKUP_ROOT", r"E:\Tunhuabinhnham-backups")) / run_id
    manifest = Manifest(run_dir / "manifest.jsonl")
    manifest.add("run", run_id=run_id, dry_run=args.dry_run, fingerprint=expected, web_port=web_port,
                 api_port=api_port, projects=projects, root=str(ROOT))

    engine = create_engine(database_url, poolclass=NullPool, connect_args={"connect_timeout": 10, "sslmode": "require"})
    baseline = snapshot(engine)
    (run_dir / "baseline.json").write_text(json.dumps(baseline, ensure_ascii=False, indent=1), encoding="utf-8")
    manifest.add("baseline", counts=baseline["counts"], auth_users=len(baseline["auth_users"]),
                 storage_objects=len(baseline["storage_objects"]), revision=baseline["revision"])
    if baseline["revision"] != ["0004"]:
        raise SystemExit(f"Unexpected revision {baseline['revision']}; expected 0004")

    # Only the API process receives server secrets; web, Playwright and pytest-free steps get public values.
    base_env = {k: v for k, v in os.environ.items() if not k.startswith(("SUPABASE_", "DATABASE_"))}
    api_env = {**base_env, **{k: v for k, v in env_values.items() if k.isupper()},
               "FRONTEND_ORIGINS": json.dumps([f"http://localhost:{web_port}", f"http://127.0.0.1:{web_port}"]),
               "FRONTEND_URL": f"http://localhost:{web_port}"}
    web_env = {**base_env, "NEXT_PUBLIC_API_URL": f"http://127.0.0.1:{api_port}/api/v1",
               "NEXT_PUBLIC_SITE_URL": f"http://localhost:{web_port}", "NEXT_PUBLIC_SUPABASE_URL": supabase_url,
               "NEXT_PUBLIC_SUPABASE_ANON_KEY": publishable, "NEXT_TELEMETRY_DISABLED": "1"}
    service: Client = create_client(supabase_url, secret_key)
    public: Client = create_client(supabase_url, publishable)
    processes: list[subprocess.Popen[bytes]] = []
    admin_id: str | None = None
    auth_user_ids: list[str] = []
    exit_code = 1
    logs = run_dir / "logs"
    logs.mkdir()
    try:
        bin_dir = ROOT / "node_modules" / ".bin"
        suffix = ".cmd" if os.name == "nt" else ""
        with (logs / "web-build.log").open("wb") as log:
            subprocess.run([str(bin_dir / f"next{suffix}"), "build"], cwd=ROOT / "apps" / "web", env=web_env, stdout=log, stderr=subprocess.STDOUT, check=True)
        processes.append(subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--app-dir", "apps/api", "--host", "127.0.0.1", "--port", str(api_port)],
            cwd=ROOT, env=api_env, stdout=(logs / "api.log").open("wb"), stderr=subprocess.STDOUT))
        processes.append(subprocess.Popen(
            [str(bin_dir / f"next{suffix}"), "start", "-p", str(web_port)],
            cwd=ROOT / "apps" / "web", env=web_env, stdout=(logs / "web.log").open("wb"), stderr=subprocess.STDOUT))
        _wait_for(f"http://127.0.0.1:{api_port}/health/ready", 120)
        _wait_for(f"http://localhost:{web_port}/admin/login", 180)
        manifest.add("servers_ready")
        if args.dry_run:
            exit_code = 0
            return exit_code

        email = f"{record_prefix}admin@example.invalid"
        password = f"GateC1-{secrets.token_urlsafe(18)}-7x!"
        user = service.auth.admin.create_user({"email": email, "password": password, "email_confirm": True}).user
        if user is None:
            raise RuntimeError("Synthetic Auth user was not created")
        auth_user_ids.append(str(user.id))
        manifest.add("created_auth_user", id=str(user.id), email=email)
        admin_id = str(uuid.uuid4())
        with engine.begin() as connection:
            connection.execute(text("insert into public.admin_users (id, auth_user_id, email, role, is_active) values (cast(:id as uuid), cast(:auth as uuid), :email, 'admin', true)"),
                               {"id": admin_id, "auth": str(user.id), "email": email})
        manifest.add("created_admin_user", id=admin_id, auth_user_id=str(user.id))
        session = public.auth.sign_in_with_password({"email": email, "password": password}).session
        if session is None:
            raise RuntimeError("Synthetic admin session was not created")

        if os.environ.get("E2E_RUN_PYTEST_LIVE") == "true":
            # Backend Auth/RLS/Storage checks (own prefixed records + own cleanup; verified by the final diff).
            with (logs / "pytest-live.log").open("wb") as log:
                pytest_run = subprocess.run([sys.executable, "-m", "pytest", "tests/test_live_supabase_gate.py", "-m", "integration_supabase", "-q"],
                                            cwd=ROOT / "apps" / "api", env={**api_env, "RUN_LIVE_SUPABASE_WRITE_TESTS": "true"},
                                            stdout=log, stderr=subprocess.STDOUT, check=False)
            manifest.add("pytest_live", exit_code=pytest_run.returncode)
        e2e_env = {**web_env, "E2E_ALLOW_STAGING_WRITES": "true", "E2E_BASE_URL": f"http://localhost:{web_port}",
                   "E2E_API_URL": f"http://127.0.0.1:{api_port}/api/v1", "E2E_ADMIN_EMAIL": email,
                   "E2E_ADMIN_PASSWORD": password, "E2E_ADMIN_ACCESS_TOKEN": session.access_token, "E2E_RUN_ID": run_id}
        playwright = str(bin_dir / f"playwright{suffix}")
        with (logs / "playwright.log").open("wb") as log:
            completed = subprocess.run(
                [playwright, "test", "e2e/staging-cms.spec.ts", "--workers=1", "--reporter=line", *[f"--project={p}" for p in projects]],
                cwd=ROOT / "apps" / "web", env=e2e_env, stdout=log, stderr=subprocess.STDOUT, check=False)
        exit_code = completed.returncode or (pytest_run.returncode if os.environ.get("E2E_RUN_PYTEST_LIVE") == "true" else 0)
        manifest.add("playwright", exit_code=completed.returncode)
        return exit_code
    finally:
        for process in reversed(processes):
            _stop_tree(process)
        failure: str | None = None
        try:
            if not args.dry_run:
                try:
                    cleanup(engine, service, baseline, manifest, admin_id, auth_user_ids, record_prefix, slug_prefix)
                finally:
                    # Always remove the synthetic Auth user (cascades its admin_users row) even if DB cleanup failed.
                    for user_id in auth_user_ids:
                        if user_id not in baseline["auth_users"]:
                            service.auth.admin.delete_user(user_id)
                            manifest.add("deleted_auth_user", id=user_id)
            after = snapshot(engine)
            (run_dir / "after.json").write_text(json.dumps(after, ensure_ascii=False, indent=1), encoding="utf-8")
            problems = diff_baseline(baseline, after)
            manifest.add("baseline_diff", problems=problems, store_name_changed=after["site_settings"].get("store_name") != baseline["site_settings"].get("store_name"))
            if problems:
                failure = "; ".join(problems)
        except Exception as error:  # report cleanup failures without hiding them
            failure = f"cleanup/verification error: {type(error).__name__}: {error}"
        finally:
            engine.dispose()
        summary = {"run_id": run_id, "dry_run": args.dry_run, "exit_code": exit_code, "baseline_ok": failure is None, "problem": failure, "manifest": str(manifest.path)}
        print(json.dumps(summary, ensure_ascii=False))
        if failure:
            sys.exit(2)


if __name__ == "__main__":
    sys.exit(main())
