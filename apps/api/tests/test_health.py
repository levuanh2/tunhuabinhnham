from fastapi.testclient import TestClient


def test_liveness_does_not_require_database(client: TestClient) -> None:
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readiness_checks_database(client: TestClient) -> None:
    response = client.get("/health/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_public_cache_and_request_id_headers(client: TestClient) -> None:
    response = client.get("/api/v1/products", headers={"X-Request-ID": "test-request"})
    assert response.headers["x-request-id"] == "test-request"
    assert response.headers["cache-control"].startswith("public")
