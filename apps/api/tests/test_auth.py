import uuid

import httpx
import jwt
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core import auth as auth_module
from app.core.auth import DecodedToken, _decode_token
from app.core.config import Settings
from app.models import AdminUser


def _settings() -> Settings:
    return Settings.model_validate(
        {
            "SUPABASE_URL": "https://project.supabase.co",
            "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_test",
        }
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
    decoded = _decode_token(token, _settings())
    assert decoded.claims["sub"] == "9257262e-608b-42e8-b208-7b890d258d7a"
    assert decoded.session_verified is True


def test_expired_or_invalid_legacy_token_returns_401(monkeypatch: pytest.MonkeyPatch) -> None:
    token = jwt.encode({"sub": "9257262e-608b-42e8-b208-7b890d258d7a"}, "a" * 32, algorithm="HS256")
    monkeypatch.setattr(httpx, "get", lambda *args, **kwargs: httpx.Response(401))

    with pytest.raises(HTTPException) as error:
        _decode_token(token, _settings())

    assert error.value.status_code == 401


def _seed_admin(db: Session) -> AdminUser:
    admin = AdminUser(
        auth_user_id=uuid.UUID("9257262e-608b-42e8-b208-7b890d258d7a"),
        email="session-admin@example.com",
        role="admin",
        is_active=True,
    )
    db.add(admin)
    db.commit()
    return admin


def test_revoked_asymmetric_session_returns_401(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _seed_admin(db)
    monkeypatch.setattr(
        auth_module,
        "_decode_token",
        lambda *_: DecodedToken(
            claims={
                "sub": "9257262e-608b-42e8-b208-7b890d258d7a",
                "session_id": "a7957711-a10b-4f4d-a778-9bc89e511926",
            },
            session_verified=False,
        ),
    )
    monkeypatch.setattr(auth_module, "_session_is_active", lambda *_: False)

    response = client.get(
        "/api/v1/auth/me", headers={"Authorization": "Bearer signed-out-token"}
    )

    assert response.status_code == 401
    assert response.json()["error"]["message"] == "Session expired or signed out"


def test_active_asymmetric_session_returns_200(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    admin = _seed_admin(db)
    monkeypatch.setattr(
        auth_module,
        "_decode_token",
        lambda *_: DecodedToken(
            claims={
                "sub": str(admin.auth_user_id),
                "session_id": "a7957711-a10b-4f4d-a778-9bc89e511926",
            },
            session_verified=False,
        ),
    )
    monkeypatch.setattr(auth_module, "_session_is_active", lambda *_: True)

    response = client.get(
        "/api/v1/auth/me", headers={"Authorization": "Bearer active-token"}
    )

    assert response.status_code == 200
    assert response.json()["email"] == admin.email


def test_asymmetric_token_without_session_id_returns_401(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _seed_admin(db)
    monkeypatch.setattr(
        auth_module,
        "_decode_token",
        lambda *_: DecodedToken(
            claims={"sub": "9257262e-608b-42e8-b208-7b890d258d7a"},
            session_verified=False,
        ),
    )

    response = client.get(
        "/api/v1/auth/me", headers={"Authorization": "Bearer missing-session"}
    )

    assert response.status_code == 401
    assert response.json()["error"]["message"] == "Session expired or signed out"
