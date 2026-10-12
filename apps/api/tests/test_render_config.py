from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]


def test_render_blueprint_has_bounded_no_deploy_backend_contract() -> None:
    blueprint = yaml.safe_load((ROOT / "render.yaml").read_text(encoding="utf-8"))
    assert "databases" not in blueprint
    assert len(blueprint["services"]) == 1
    service = blueprint["services"][0]

    assert service["type"] == "web"
    assert service["runtime"] == "python"
    assert service["region"] == "singapore"
    assert service["plan"] == "free"
    assert service["branch"] == "deploy/c2-preview"
    assert service["autoDeployTrigger"] == "off"
    assert service["healthCheckPath"] == "/health/ready"
    assert "--host 0.0.0.0" in service["startCommand"]
    assert "--port $PORT" in service["startCommand"]
    assert "apps/api/build-requirements.lock" in service["buildCommand"]
    assert "apps/api/requirements.lock" in service["buildCommand"]

    env = {entry["key"]: entry for entry in service["envVars"]}
    assert {
        "APP_ENV",
        "DATABASE_URL",
        "CORS_ORIGINS",
        "FRONTEND_URL",
        "SUPABASE_URL",
        "SUPABASE_PUBLISHABLE_KEY",
        "SUPABASE_SECRET_KEY",
        "SUPABASE_JWT_ISSUER",
        "SUPABASE_JWT_AUDIENCE",
        "SUPABASE_JWKS_URL",
        "MAX_UPLOAD_BYTES",
        "CONTACT_TRACKING_ENABLED",
        "DB_POOL_SIZE",
        "DB_MAX_OVERFLOW",
        "DB_POOL_TIMEOUT_SECONDS",
        "DB_CONNECT_TIMEOUT_SECONDS",
        "DB_DISABLE_PREPARED_STATEMENTS",
        "PUBLIC_CACHE_SECONDS",
        "ADMIN_RATE_LIMIT_PER_MINUTE",
    } <= env.keys()
    assert env["PYTHON_VERSION"]["value"] == "3.11.17"
    assert env["WEB_CONCURRENCY"]["value"] == "1"
    assert env["MAX_UPLOAD_BYTES"]["value"] == "8388608"
    assert env["CONTACT_TRACKING_ENABLED"]["value"] == "true"
    assert env["DB_POOL_SIZE"]["value"] == "3"
    assert env["DB_MAX_OVERFLOW"]["value"] == "1"
    assert env["PUBLIC_CACHE_SECONDS"]["value"] == "60"
    dashboard_prompt_names = {
        "DATABASE_URL",
        "SUPABASE_URL",
        "SUPABASE_PUBLISHABLE_KEY",
        "SUPABASE_SECRET_KEY",
        "SUPABASE_JWT_ISSUER",
        "SUPABASE_JWKS_URL",
        "CORS_ORIGINS",
        "FRONTEND_URL",
    }
    assert {name for name, entry in env.items() if entry.get("sync") is False} == (
        dashboard_prompt_names
    )
    for secret_name in dashboard_prompt_names:
        assert env[secret_name] == {"key": secret_name, "sync": False}


def test_post_conflict_is_part_of_openapi_contract(client) -> None:  # type: ignore[no-untyped-def]
    operation = client.get("/openapi.json").json()["paths"]["/api/v1/admin/posts/{item_id}"][
        "patch"
    ]
    assert operation["responses"]["409"]["description"] == (
        "Conflict with existing unique data"
    )
