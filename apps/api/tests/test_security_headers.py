from fastapi.testclient import TestClient


def test_api_responses_carry_security_headers(client: TestClient) -> None:
    for response in (
        client.get("/health/live"),
        client.get("/api/v1/products"),
        client.post("/api/v1/contact-clicks", json={"product_id": "bad"}),
        client.get("/api/v1/admin/products"),
    ):
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["x-frame-options"] == "DENY"
        assert response.headers["referrer-policy"] == "no-referrer"
        assert response.headers["content-security-policy"] == (
            "default-src 'none'; frame-ancestors 'none'"
        )


def test_api_docs_keep_working_without_the_json_csp(client: TestClient) -> None:
    response = client.get("/docs")
    assert response.status_code == 200
    assert "content-security-policy" not in response.headers
