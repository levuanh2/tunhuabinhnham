from fastapi.testclient import TestClient


def test_allowed_origin_preflight(client: TestClient) -> None:
    response = client.options(
        "/api/v1/admin/products",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Authorization",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert "Authorization" in response.headers["access-control-allow-headers"]


def test_disallowed_origin_has_no_allow_origin(client: TestClient) -> None:
    response = client.get("/health", headers={"Origin": "https://attacker.example"})
    assert "access-control-allow-origin" not in response.headers


def test_disallowed_origin_preflight_is_rejected(client: TestClient) -> None:
    response = client.options(
        "/api/v1/admin/products",
        headers={
            "Origin": "https://attacker.example",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Authorization,Content-Type",
        },
    )
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_allowed_origin_admin_unauthorized_response_has_cors(client: TestClient) -> None:
    response = client.get(
        "/api/v1/admin/products", headers={"Origin": "http://localhost:3000"}
    )
    assert response.status_code == 401
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert response.headers["cache-control"] == "no-store"
