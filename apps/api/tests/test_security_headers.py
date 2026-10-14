from collections.abc import Generator

from fastapi.testclient import TestClient

from app.core import rate_limit
from app.core.config import get_settings
from app.db.session import get_db
from app.main import app

EXPECTED = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "strict-transport-security": "max-age=15552000",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
}


def assert_secure(response) -> None:  # type: ignore[no-untyped-def]
    for name, value in EXPECTED.items():
        assert response.headers.get(name) == value, (response.status_code, name)
    assert "camera=()" in response.headers["permissions-policy"]


def test_api_responses_carry_security_headers(client: TestClient) -> None:
    for response in (
        client.get("/health/live"),
        client.get("/api/v1/products"),
        client.post("/api/v1/contact-clicks", json={"product_id": "bad"}),
        client.get("/api/v1/admin/products"),
    ):
        assert_secure(response)


def test_api_docs_keep_working_without_the_json_csp(client: TestClient) -> None:
    response = client.get("/docs")
    assert response.status_code == 200
    assert "content-security-policy" not in response.headers


def test_unhandled_500_is_redacted_and_keeps_cors_and_security_headers() -> None:
    def broken_db() -> Generator[None, None, None]:
        raise RuntimeError("database exploded with a secret dsn")
        yield  # pragma: no cover

    origin = get_settings().allowed_origins[0]
    app.dependency_overrides[get_db] = broken_db
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/api/v1/products", headers={"Origin": origin})
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "internal_error"
    assert "secret" not in response.text
    assert response.headers["access-control-allow-origin"] == origin
    assert_secure(response)
    # An error is never cached publicly.
    assert "public" not in response.headers.get("cache-control", "")


def test_rate_limited_response_keeps_cors_and_security_headers(client: TestClient) -> None:
    rate_limit.contact_client_rate_limiter._entries.clear()
    origin = get_settings().allowed_origins[0]
    codes = []
    for _ in range(11):
        response = client.post("/api/v1/contact-clicks", json={}, headers={"Origin": origin})
        codes.append(response.status_code)
    assert codes[-1] == 429
    assert response.headers["access-control-allow-origin"] == origin
    assert response.headers["retry-after"]
    assert_secure(response)
    rate_limit.contact_client_rate_limiter._entries.clear()
