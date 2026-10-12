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
import shlex
import signal
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

PASS = 0
TEST_FAILED = 1
CLEANUP_INCOMPLETE = 2
INFRA_FAILED = 3
INTERRUPTED = 130
STATUS_NAMES = {
    PASS: "PASS",
    TEST_FAILED: "TEST_FAILED",
    CLEANUP_INCOMPLETE: "CLEANUP_INCOMPLETE",
    INFRA_FAILED: "INFRA_FAILED",
    INTERRUPTED: "INTERRUPTED",
}

# These bounds are intentionally generous for the Windows CI-class workstation while still
# guaranteeing that a lost child process cannot leave the harness apparently hung forever.
BUILD_TIMEOUT_SECONDS = 600
SERVER_START_TIMEOUT_SECONDS = 180
PYTEST_TIMEOUT_SECONDS = 600
PLAYWRIGHT_TIMEOUT_SECONDS = 2400  # Ten serial tests across desktop and mobile WebKit.


class PhaseTimeout(RuntimeError):
    def __init__(self, phase: str, timeout_seconds: int) -> None:
        super().__init__(f"{phase} exceeded {timeout_seconds}s")
        self.phase = phase
        self.timeout_seconds = timeout_seconds


class InfrastructureFailure(RuntimeError):
    pass


def _progress(phase: str, message: str) -> None:
    stamp = datetime.now(UTC).isoformat(timespec="seconds")
    print(f"[{stamp}] [{phase}] {message}", flush=True)


def _redacted_command(command: list[str]) -> str:
    """Render a command without ever echoing argument values that look like secrets."""
    safe: list[str] = []
    redact_next = False
    for item in command:
        if redact_next:
            safe.append("[REDACTED]")
            redact_next = False
            continue
        lowered = item.lower()
        if lowered in {"--password", "--token", "--secret", "--key", "--db-url"}:
            safe.append(item)
            redact_next = True
        elif any(marker in lowered for marker in ("password=", "token=", "secret=", "key=")):
            safe.append(item.split("=", 1)[0] + "=[REDACTED]")
        else:
            safe.append(item)
    return subprocess.list2cmdline(safe) if os.name == "nt" else shlex.join(safe)


def _merge_frontend_origins(raw: str | None, web_port: int) -> str:
    origins: list[str] = []
    value = (raw or "").strip()
    if value:
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            parsed = [part.strip() for part in value.split(",")]
        if isinstance(parsed, str):
            parsed = [parsed]
        if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
            raise ValueError("FRONTEND_ORIGINS must be a JSON string list or comma-separated list")
        origins.extend(item.strip().rstrip("/") for item in parsed if item.strip())
    for origin in (f"http://localhost:{web_port}", f"http://127.0.0.1:{web_port}"):
        if origin not in origins:
            origins.append(origin)
    return json.dumps(origins)


def _make_run_id(now: datetime, suffix: str) -> str:
    """Return an identifier that is safe inside HTML5/Zod slug fields."""
    return f"gc-{now.astimezone(UTC):%Y%m%dt%H%M%Sz}-{suffix.lower()}"


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
        raise ValueError("SUPABASE_URL is not a hosted Supabase project URL")
    return hashlib.sha256(match.group(1).encode()).hexdigest()[:12]


def _port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        return sock.connect_ex(("127.0.0.1", port)) != 0


def _wait_for(url: str, timeout: float, process: subprocess.Popen[bytes]) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise InfrastructureFailure(
                f"Server exited with code {process.returncode} before becoming ready"
            )
        try:
            if httpx.get(url, timeout=5).status_code < 500:
                return
        except httpx.HTTPError:
            pass
        time.sleep(2)
    raise PhaseTimeout("server_start", int(timeout))


def _popen_group_options() -> dict[str, Any]:
    if os.name == "nt":
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}


def _stop_tree(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=30,
        )
    else:
        kill_process_group = os.killpg  # type: ignore[attr-defined]
        kill_process_group(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            kill_process_group(process.pid, signal.SIGKILL)  # type: ignore[attr-defined]


def _run_logged(
    phase: str,
    command: list[str],
    *,
    cwd: Path,
    env: dict[str, str],
    log_path: Path,
    timeout_seconds: int,
) -> int:
    _progress(
        phase,
        f"starting (timeout={timeout_seconds}s): {_redacted_command(command)}; log={log_path}",
    )
    with log_path.open("ab") as log:
        process = subprocess.Popen(
            command,
            cwd=cwd,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            **_popen_group_options(),
        )
        try:
            return_code = process.wait(timeout=timeout_seconds)
        except subprocess.TimeoutExpired as error:
            _progress(phase, "timed out; terminating child process tree")
            _stop_tree(process)
            raise PhaseTimeout(phase, timeout_seconds) from error
        except KeyboardInterrupt:
            _progress(phase, "interrupted; terminating child process tree")
            _stop_tree(process)
            raise
    _progress(phase, f"completed with exit_code={return_code}")
    return return_code


def _start_logged_process(
    phase: str,
    command: list[str],
    *,
    cwd: Path,
    env: dict[str, str],
    log_path: Path,
) -> subprocess.Popen[bytes]:
    _progress(phase, f"starting: {_redacted_command(command)}; log={log_path}")
    with log_path.open("ab") as log:
        return subprocess.Popen(
            command,
            cwd=cwd,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            **_popen_group_options(),
        )


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


def _normalized_setting(value: Any) -> str | None:
    return str(value) if value is not None else None


def _restore_settings_if_changed(
    connection: Connection, baseline_settings: dict[str, Any]
) -> list[str]:
    """Restore mutable settings only when values differ; never touch store_name/updated_at."""
    settings_id = baseline_settings.get("id")
    if not settings_id:
        return []
    columns = ", ".join(SETTINGS_FIELDS)
    current = connection.execute(
        text(f"select {columns} from public.site_settings where id = cast(:id as uuid)"),
        {"id": settings_id},
    ).mappings().first()
    if current is None:
        raise RuntimeError("Cannot restore settings: baseline site_settings row is missing")
    changed = [
        field
        for field in SETTINGS_FIELDS
        if _normalized_setting(current[field]) != baseline_settings.get(field)
    ]
    if not changed:
        return []
    assignments = ", ".join(f"{field} = :{field}" for field in changed)
    params: dict[str, Any] = {field: baseline_settings.get(field) for field in changed}
    if "contact_tracking_enabled" in params:
        params["contact_tracking_enabled"] = params["contact_tracking_enabled"] == "True"
    params["id"] = settings_id
    connection.execute(
        text(f"update public.site_settings set {assignments} where id = cast(:id as uuid)"),
        params,
    )
    return changed


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
        restored_fields = _restore_settings_if_changed(connection, baseline["site_settings"])
        if restored_fields:
            manifest.add("settings_restored", fields=restored_fields)
        for banner in baseline["banners"]:
            connection.execute(
                text(
                    "update public.banners set sort_order=:sort_order, is_active=:is_active "
                    "where id = cast(:id as uuid) "
                    "and (sort_order is distinct from :sort_order or is_active is distinct from :is_active)"
                ),
                banner,
            )
        # Remove Storage objects before their media rows so a retry can rediscover the keys if
        # the Storage API fails. Removing an already-absent key is safe and keeps cleanup idempotent.
        for bucket, key in objects:
            if f"{bucket}/{key}" not in baseline["storage_objects"]:
                service.storage.from_(bucket).remove([key])
                manifest.add("deleted_object", bucket=bucket, key=key)
        for table in ("contact_clicks", "audit_logs", "products", "posts", "banners", "categories", "media_assets"):
            if found[table]:
                connection.execute(text(f"delete from public.{table} where id = any(cast(:ids as uuid[]))"), {"ids": found[table]})
        if admin_id and admin_id not in base["admin_users"]:
            connection.execute(text("delete from public.admin_users where id = cast(:a as uuid)"), {"a": admin_id})



def main() -> int:
    parser = argparse.ArgumentParser(description="Gate C1 live CMS E2E harness")
    parser.add_argument("--dry-run", action="store_true", help="identity, baseline and server checks only; no Supabase writes")
    args = parser.parse_args()
    if os.getenv("RUN_LIVE_CMS_E2E") != "true":
        _progress("guard", "FAILED: RUN_LIVE_CMS_E2E is not true")
        return INFRA_FAILED
    secrets_file = Path(os.environ.get("E2E_SECRETS_ENV_FILE", ""))
    if not secrets_file.is_file():
        _progress("guard", "FAILED: E2E_SECRETS_ENV_FILE is not a file")
        return INFRA_FAILED
    env_values = _load_env_file(secrets_file)
    supabase_url = env_values.get("SUPABASE_URL", "")
    publishable = env_values.get("SUPABASE_PUBLISHABLE_KEY") or env_values.get("SUPABASE_ANON_KEY", "")
    secret_key = env_values.get("SUPABASE_SECRET_KEY") or env_values.get("SUPABASE_SERVICE_ROLE_KEY", "")
    database_url = _db_url(env_values.get("DATABASE_URL", ""))
    expected = os.environ.get("E2E_EXPECTED_REF_FINGERPRINT", "")
    if not (supabase_url and publishable and secret_key and database_url.startswith("postgresql")):
        _progress("guard", "FAILED: backend environment is missing required settings")
        return INFRA_FAILED
    try:
        actual_fingerprint = _fingerprint(supabase_url)
    except ValueError as error:
        _progress("guard", f"FAILED: {error}")
        return INFRA_FAILED
    if not expected or actual_fingerprint != expected:
        _progress("guard", "FAILED: project fingerprint mismatch")
        return INFRA_FAILED

    try:
        web_port = int(os.environ.get("E2E_WEB_PORT", "3200"))
        api_port = int(os.environ.get("E2E_API_PORT", "8200"))
        frontend_origins = _merge_frontend_origins(
            env_values.get("FRONTEND_ORIGINS"), web_port
        )
    except ValueError as error:
        _progress("guard", f"FAILED: invalid harness configuration ({type(error).__name__})")
        return INFRA_FAILED
    for port in (web_port, api_port):
        if not _port_free(port):
            _progress("guard", f"FAILED: port {port} is in use")
            return INFRA_FAILED
    projects = [p for p in os.environ.get("E2E_PROJECTS", "desktop,mobile").split(",") if p]
    run_id = _make_run_id(datetime.now(UTC), secrets.token_hex(3))
    record_prefix, slug_prefix = f"__e2e_{run_id}_", f"e2e-{run_id}"
    run_dir = Path(os.environ.get("E2E_BACKUP_ROOT", r"E:\Tunhuabinhnham-backups")) / run_id
    manifest = Manifest(run_dir / "manifest.jsonl")
    manifest.add("run", run_id=run_id, dry_run=args.dry_run, fingerprint=expected, web_port=web_port,
                 api_port=api_port, projects=projects, root=str(ROOT))

    # Only the API process receives server secrets; web, Playwright and pytest-free steps get public values.
    base_env = {k: v for k, v in os.environ.items() if not k.startswith(("SUPABASE_", "DATABASE_"))}
    api_env = {**base_env, **{k: v for k, v in env_values.items() if k.isupper()},
               "FRONTEND_ORIGINS": frontend_origins,
               "FRONTEND_URL": f"http://localhost:{web_port}"}
    web_env = {**base_env, "NEXT_PUBLIC_API_URL": f"http://127.0.0.1:{api_port}/api/v1",
               "NEXT_PUBLIC_SITE_URL": f"http://localhost:{web_port}", "NEXT_PUBLIC_SUPABASE_URL": supabase_url,
               "NEXT_PUBLIC_SUPABASE_ANON_KEY": publishable, "NEXT_TELEMETRY_DISABLED": "1"}
    service: Client | None = None
    engine: Engine | None = None
    baseline: dict[str, Any] | None = None
    processes: list[subprocess.Popen[bytes]] = []
    admin_id: str | None = None
    auth_user_ids: list[str] = []
    exit_code = INFRA_FAILED
    interrupted = False
    cleanup_errors: list[str] = []
    baseline_problems: list[str] = []
    phase_results: dict[str, dict[str, Any]] = {
        "pytest_live": {"status": "skipped", "exit_code": None},
        "playwright": {"status": "skipped", "exit_code": None},
    }
    logs = run_dir / "logs"
    logs.mkdir()

    def record_phase(phase: str, status: str, **data: Any) -> None:
        result = {"status": status, **data}
        phase_results[phase] = result
        manifest.add("phase_result", phase=phase, **result)

    try:
        _progress("baseline", "capturing read-only live baseline")
        engine = create_engine(
            database_url,
            poolclass=NullPool,
            connect_args={"connect_timeout": 10, "sslmode": "require"},
        )
        baseline = snapshot(engine)
        (run_dir / "baseline.json").write_text(
            json.dumps(baseline, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        manifest.add("baseline", counts=baseline["counts"], auth_users=len(baseline["auth_users"]),
                     storage_objects=len(baseline["storage_objects"]), revision=baseline["revision"])
        if baseline["revision"] != ["0004"]:
            raise InfrastructureFailure(
                f"Unexpected revision {baseline['revision']}; expected 0004"
            )
        _progress("baseline", "PASS: fingerprint, revision and baseline captured")

        bin_dir = ROOT / "node_modules" / ".bin"
        suffix = ".cmd" if os.name == "nt" else ""
        build_command = [str(bin_dir / f"next{suffix}"), "build"]
        build_exit = _run_logged(
            "build",
            build_command,
            cwd=ROOT / "apps" / "web",
            env=web_env,
            log_path=logs / "web-build.log",
            timeout_seconds=BUILD_TIMEOUT_SECONDS,
        )
        record_phase("build", "passed" if build_exit == 0 else "failed", exit_code=build_exit,
                     timeout_seconds=BUILD_TIMEOUT_SECONDS, log="logs/web-build.log")
        if build_exit != 0:
            raise InfrastructureFailure("Web build failed; see logs/web-build.log")

        api_process = _start_logged_process(
            "api_server",
            [sys.executable, "-m", "uvicorn", "app.main:app", "--app-dir", "apps/api",
             "--host", "127.0.0.1", "--port", str(api_port)],
            cwd=ROOT,
            env=api_env,
            log_path=logs / "api.log",
        )
        processes.append(api_process)
        web_process = _start_logged_process(
            "web_server",
            [str(bin_dir / f"next{suffix}"), "start", "-p", str(web_port)],
            cwd=ROOT / "apps" / "web",
            env=web_env,
            log_path=logs / "web.log",
        )
        processes.append(web_process)
        _progress("server_start", f"waiting up to {SERVER_START_TIMEOUT_SECONDS}s per server")
        _wait_for(
            f"http://127.0.0.1:{api_port}/health/ready",
            SERVER_START_TIMEOUT_SECONDS,
            api_process,
        )
        _wait_for(
            f"http://localhost:{web_port}/admin/login",
            SERVER_START_TIMEOUT_SECONDS,
            web_process,
        )
        record_phase("server_start", "passed", exit_code=0,
                     timeout_seconds=SERVER_START_TIMEOUT_SECONDS,
                     logs=["logs/api.log", "logs/web.log"])
        manifest.add("servers_ready")
        _progress("server_start", "PASS: API and web readiness checks succeeded")
        if args.dry_run:
            exit_code = PASS
            _progress("dry_run", "PASS: write gate remains closed; skipping fixtures and tests")
        else:
            service = create_client(supabase_url, secret_key)
            public: Client = create_client(supabase_url, publishable)

            _progress("fixtures", "creating run-scoped synthetic Auth/admin fixtures")
            email = f"{record_prefix}admin@example.invalid"
            password = f"GateC1-{secrets.token_urlsafe(18)}-7x!"
            user = service.auth.admin.create_user(
                {"email": email, "password": password, "email_confirm": True}
            ).user
            if user is None:
                raise InfrastructureFailure("Synthetic Auth user was not created")
            auth_user_ids.append(str(user.id))
            manifest.add("created_auth_user", id=str(user.id), email=email)
            admin_id = str(uuid.uuid4())
            with engine.begin() as connection:
                connection.execute(
                    text(
                        "insert into public.admin_users "
                        "(id, auth_user_id, email, role, is_active) "
                        "values (cast(:id as uuid), cast(:auth as uuid), :email, 'admin', true)"
                    ),
                    {"id": admin_id, "auth": str(user.id), "email": email},
                )
            manifest.add("created_admin_user", id=admin_id, auth_user_id=str(user.id))
            session = public.auth.sign_in_with_password(
                {"email": email, "password": password}
            ).session
            if session is None:
                raise InfrastructureFailure("Synthetic admin session was not created")
            _progress("fixtures", "PASS: synthetic fixtures and session created")

            test_failed = False
            if os.environ.get("E2E_RUN_PYTEST_LIVE") == "true":
                try:
                    pytest_exit = _run_logged(
                        "pytest_live",
                        [sys.executable, "-m", "pytest", "tests/test_live_supabase_gate.py",
                         "-m", "integration_supabase", "-q"],
                        cwd=ROOT / "apps" / "api",
                        env={**api_env, "RUN_LIVE_SUPABASE_WRITE_TESTS": "true"},
                        log_path=logs / "pytest-live.log",
                        timeout_seconds=PYTEST_TIMEOUT_SECONDS,
                    )
                    record_phase("pytest_live", "passed" if pytest_exit == 0 else "failed",
                                 exit_code=pytest_exit, timeout_seconds=PYTEST_TIMEOUT_SECONDS,
                                 log="logs/pytest-live.log")
                    test_failed = test_failed or pytest_exit != 0
                except PhaseTimeout:
                    record_phase("pytest_live", "timeout", exit_code=None,
                                 timeout_seconds=PYTEST_TIMEOUT_SECONDS,
                                 log="logs/pytest-live.log")
                    test_failed = True
            else:
                record_phase("pytest_live", "skipped", exit_code=None)

            e2e_env = {
                **web_env,
                "E2E_ALLOW_STAGING_WRITES": "true",
                "E2E_BASE_URL": f"http://localhost:{web_port}",
                "E2E_API_URL": f"http://127.0.0.1:{api_port}/api/v1",
                "E2E_ADMIN_EMAIL": email,
                "E2E_ADMIN_PASSWORD": password,
                "E2E_ADMIN_ACCESS_TOKEN": session.access_token,
                "E2E_RUN_ID": run_id,
            }
            playwright = str(bin_dir / f"playwright{suffix}")
            try:
                playwright_exit = _run_logged(
                    "playwright",
                    [playwright, "test", "e2e/staging-cms.spec.ts", "--workers=1",
                     "--reporter=line", *[f"--project={project}" for project in projects]],
                    cwd=ROOT / "apps" / "web",
                    env=e2e_env,
                    log_path=logs / "playwright.log",
                    timeout_seconds=PLAYWRIGHT_TIMEOUT_SECONDS,
                )
                record_phase("playwright", "passed" if playwright_exit == 0 else "failed",
                             exit_code=playwright_exit, timeout_seconds=PLAYWRIGHT_TIMEOUT_SECONDS,
                             log="logs/playwright.log")
                test_failed = test_failed or playwright_exit != 0
            except PhaseTimeout:
                record_phase("playwright", "timeout", exit_code=None,
                             timeout_seconds=PLAYWRIGHT_TIMEOUT_SECONDS,
                             log="logs/playwright.log")
                test_failed = True
            exit_code = TEST_FAILED if test_failed else PASS
    except KeyboardInterrupt:
        interrupted = True
        exit_code = INTERRUPTED
        manifest.add("interrupted")
        _progress("interrupt", "received KeyboardInterrupt; cleanup will continue")
    except PhaseTimeout as error:
        exit_code = INFRA_FAILED
        record_phase(error.phase, "timeout", exit_code=None,
                     timeout_seconds=error.timeout_seconds)
        _progress(error.phase, f"INFRA_FAILED: exceeded {error.timeout_seconds}s")
    except Exception as error:
        exit_code = INFRA_FAILED
        manifest.add("infrastructure_failure", error_type=type(error).__name__)
        _progress("infra", f"FAILED: {type(error).__name__}; see run logs/manifest")
    finally:
        _progress("cleanup", "stopping child process trees")
        for process in reversed(processes):
            try:
                _stop_tree(process)
            except KeyboardInterrupt:
                interrupted = True
                cleanup_errors.append("KeyboardInterrupt while stopping a child process tree")
            except Exception as error:
                cleanup_errors.append(f"process stop: {type(error).__name__}")
        try:
            if baseline is not None and engine is not None and service is not None and not args.dry_run:
                try:
                    cleanup(engine, service, baseline, manifest, admin_id, auth_user_ids, record_prefix, slug_prefix)
                except KeyboardInterrupt:
                    interrupted = True
                    cleanup_errors.append("KeyboardInterrupt during database cleanup")
                except Exception as error:
                    cleanup_errors.append(f"database cleanup: {type(error).__name__}")
                # Auth cleanup remains independent and idempotent if relational cleanup fails.
                for user_id in auth_user_ids:
                    if user_id not in baseline["auth_users"]:
                        try:
                            service.auth.admin.delete_user(user_id)
                            manifest.add("deleted_auth_user", id=user_id)
                        except KeyboardInterrupt:
                            interrupted = True
                            cleanup_errors.append("KeyboardInterrupt during Auth cleanup")
                        except Exception as error:
                            cleanup_errors.append(f"Auth cleanup: {type(error).__name__}")
            if baseline is not None and engine is not None:
                try:
                    after = snapshot(engine)
                    (run_dir / "after.json").write_text(
                        json.dumps(after, ensure_ascii=False, indent=1), encoding="utf-8"
                    )
                    baseline_problems = diff_baseline(baseline, after)
                    manifest.add(
                        "baseline_diff",
                        problems=baseline_problems,
                        store_name_changed=(
                            after["site_settings"].get("store_name")
                            != baseline["site_settings"].get("store_name")
                        ),
                    )
                except KeyboardInterrupt:
                    interrupted = True
                    cleanup_errors.append("KeyboardInterrupt during final baseline verification")
                except Exception as error:
                    cleanup_errors.append(f"baseline verification: {type(error).__name__}")
        finally:
            if engine is not None:
                try:
                    engine.dispose()
                except KeyboardInterrupt:
                    interrupted = True
                    cleanup_errors.append("KeyboardInterrupt while disposing database engine")
        if baseline_problems:
            cleanup_errors.append("baseline diff failed")
        if cleanup_errors:
            exit_code = CLEANUP_INCOMPLETE
        elif interrupted:
            exit_code = INTERRUPTED
        status_name = STATUS_NAMES[exit_code]
        manifest.add(
            "final_status",
            status=status_name,
            exit_code=exit_code,
            cleanup_errors=cleanup_errors,
            baseline_problems=baseline_problems,
            phases=phase_results,
        )
        _progress("final", f"{status_name} exit_code={exit_code}")
        summary = {
            "run_id": run_id,
            "dry_run": args.dry_run,
            "status": status_name,
            "exit_code": exit_code,
            "baseline_ok": not baseline_problems,
            "cleanup_ok": not cleanup_errors,
            "phases": phase_results,
            "manifest": str(manifest.path),
        }
        print(json.dumps(summary, ensure_ascii=False))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
