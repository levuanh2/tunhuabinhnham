import uuid
from dataclasses import dataclass

import httpx
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from sqlalchemy import Uuid, column, select, table
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.rate_limit import admin_rate_limiter
from app.db.session import get_db
from app.models import AdminUser

bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class CurrentAdmin:
    id: uuid.UUID
    auth_user_id: uuid.UUID
    email: str
    role: str


@dataclass(frozen=True)
class DecodedToken:
    claims: dict[str, object]
    session_verified: bool


AUTH_SESSIONS = table(
    "sessions",
    column("id", Uuid),
    column("user_id", Uuid),
    schema="auth",
)


def _decode_token(token: str, settings: Settings) -> DecodedToken:
    try:
        algorithm = str(jwt.get_unverified_header(token).get("alg", ""))
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    # Projects that still use Supabase's legacy HS256 signing secret do not
    # expose a usable public key through JWKS. Verify those tokens with the
    # Auth server instead of copying the JWT secret into this application.
    if algorithm == "HS256":
        return _verify_legacy_token(token, settings)

    if algorithm not in {"RS256", "ES256", "EdDSA"}:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unsupported access token algorithm",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not settings.supabase_jwks_url or not settings.supabase_jwt_issuer:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication is not configured",
        )
    try:
        signing_key = PyJWKClient(
            settings.supabase_jwks_url, cache_keys=True
        ).get_signing_key_from_jwt(token)
        return DecodedToken(
            claims=jwt.decode(
                token,
                signing_key.key,
                algorithms=[algorithm],
                audience=settings.supabase_jwt_audience,
                issuer=settings.supabase_jwt_issuer,
                options={"require": ["exp", "sub", "iss", "aud"]},
            ),
            session_verified=False,
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


def _verify_legacy_token(token: str, settings: Settings) -> DecodedToken:
    if not settings.supabase_url or not settings.supabase_publishable_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication is not configured",
        )
    try:
        response = httpx.get(
            f"{settings.supabase_url.rstrip('/')}/auth/v1/user",
            headers={
                "apikey": settings.supabase_publishable_key,
                "Authorization": f"Bearer {token}",
            },
            timeout=5.0,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service is unavailable",
        ) from exc
    if response.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        user_id = response.json()["id"]
        uuid.UUID(str(user_id))
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication response",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    return DecodedToken(claims={"sub": str(user_id)}, session_verified=True)


def _session_is_active(
    db: Session, auth_user_id: uuid.UUID, session_id: uuid.UUID
) -> bool:
    active_session_id = db.scalar(
        select(AUTH_SESSIONS.c.id)
        .where(
            AUTH_SESSIONS.c.id == session_id,
            AUTH_SESSIONS.c.user_id == auth_user_id,
        )
        .limit(1)
    )
    return active_session_id is not None


def require_admin(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> CurrentAdmin:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    decoded = _decode_token(credentials.credentials, settings)
    claims = decoded.claims
    try:
        auth_user_id = uuid.UUID(str(claims["sub"]))
    except (KeyError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject"
        ) from exc
    if not decoded.session_verified:
        try:
            session_id = uuid.UUID(str(claims["session_id"]))
        except (KeyError, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired or signed out",
                headers={"WWW-Authenticate": "Bearer"},
            ) from exc
        if not _session_is_active(db, auth_user_id, session_id):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired or signed out",
                headers={"WWW-Authenticate": "Bearer"},
            )
    admin = db.scalar(
        select(AdminUser).where(
            AdminUser.auth_user_id == auth_user_id, AdminUser.is_active.is_(True)
        )
    )
    if admin is None or admin.role not in {"admin", "editor"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access required"
        )
    return CurrentAdmin(
        id=admin.id, auth_user_id=admin.auth_user_id, email=admin.email, role=admin.role
    )


def require_rate_limited_admin(
    request: Request,
    admin: CurrentAdmin = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> CurrentAdmin:
    retry_after = admin_rate_limiter.retry_after(
        f"admin:{admin.id}", settings.admin_rate_limit_per_minute
    )
    if retry_after is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many administrator requests",
            headers={"Retry-After": str(retry_after)},
        )
    return admin
