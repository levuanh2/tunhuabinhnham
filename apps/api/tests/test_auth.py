import httpx
import jwt
import pytest
from fastapi import HTTPException

from app.core.auth import _decode_token
from app.core.config import Settings


def _settings() -> Settings:
    return Settings(
        SUPABASE_URL="https://project.supabase.co",
        SUPABASE_PUBLISHABLE_KEY="sb_publishable_test",
    )


def test_legacy_hs256_token_is_verified_by_supabase_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    token = jwt.encode({"sub": "9257262e-608b-42e8-b208-7b890d258d7a"}, "a" * 32, algorithm="HS256")

    def get(url: str, **kwargs: object) -> httpx.Response:
        assert url == "https://project.supabase.co/auth/v1/user"
        headers = kwargs["headers"]
        assert isinstance(headers, dict)
        assert headers["Authorization"] == f"Bearer {token}"
        return httpx.Response(200, json={"id": "9257262e-608b-42e8-b208-7b890d258d7a"})

    monkeypatch.setattr(httpx, "get", get)
    assert _decode_token(token, _settings())["sub"] == "9257262e-608b-42e8-b208-7b890d258d7a"


def test_expired_or_invalid_legacy_token_returns_401(monkeypatch: pytest.MonkeyPatch) -> None:
    token = jwt.encode({"sub": "9257262e-608b-42e8-b208-7b890d258d7a"}, "a" * 32, algorithm="HS256")
    monkeypatch.setattr(httpx, "get", lambda *args, **kwargs: httpx.Response(401))

    with pytest.raises(HTTPException) as error:
        _decode_token(token, _settings())

    assert error.value.status_code == 401
