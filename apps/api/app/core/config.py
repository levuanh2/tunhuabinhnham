from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit

from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # hide_input_in_errors: a validation error must never echo DATABASE_URL or keys back.
    model_config = SettingsConfigDict(
        env_file=(".env", "apps/api/.env"), extra="ignore", hide_input_in_errors=True
    )

    app_env: Literal["development", "test", "staging", "production"] = "development"
    port: int = Field(default=8000, ge=1, le=65535)
    database_url: str = "sqlite+pysqlite:///./local.db"
    cors_origins: str = Field(
        default="http://localhost:3000",
        validation_alias=AliasChoices("CORS_ORIGINS", "FRONTEND_ORIGINS"),
    )
    frontend_url: str = "http://localhost:3000"
    supabase_url: str = ""
    supabase_publishable_key: str = Field(
        default="", validation_alias=AliasChoices("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY")
    )
    supabase_secret_key: str = Field(
        default="",
        validation_alias=AliasChoices("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
    )
    supabase_jwt_issuer: str = ""
    supabase_jwt_audience: str = "authenticated"
    supabase_jwks_url: str = ""
    max_upload_bytes: int = 8 * 1024 * 1024
    contact_tracking_enabled: bool = True
    db_pool_size: int = Field(default=5, ge=1, le=20)
    db_max_overflow: int = Field(default=2, ge=0, le=20)
    db_pool_timeout_seconds: int = Field(default=10, ge=1, le=60)
    db_connect_timeout_seconds: int = Field(default=5, ge=1, le=30)
    db_disable_prepared_statements: bool = False
    public_cache_seconds: int = Field(default=60, ge=0, le=3600)
    admin_rate_limit_per_minute: int = Field(default=120, ge=10, le=10_000)
    contact_click_limit_per_minute: int = Field(default=10, ge=1, le=1000)
    contact_click_global_limit_per_hour: int = Field(default=300, ge=1, le=100_000)
    # A header the edge in front of the API sets and overwrites, e.g. CF-Connecting-IP.
    # Empty means the socket peer, which behind a proxy is the proxy itself.
    client_ip_header: str = ""

    @field_validator("database_url")
    @classmethod
    def normalize_database_driver(cls, value: str) -> str:
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
        return value

    @model_validator(mode="after")
    def validate_production_settings(self) -> "Settings":
        if self.app_env != "production":
            return self
        if not self.database_url.startswith("postgresql"):
            raise ValueError("Production DATABASE_URL must use PostgreSQL")
        required = {
            "SUPABASE_URL": self.supabase_url,
            "SUPABASE_PUBLISHABLE_KEY": self.supabase_publishable_key,
            "SUPABASE_SECRET_KEY": self.supabase_secret_key,
            "SUPABASE_JWT_ISSUER": self.supabase_jwt_issuer,
            "SUPABASE_JWKS_URL": self.supabase_jwks_url,
            "CORS_ORIGINS": self.cors_origins,
            "FRONTEND_URL": self.frontend_url,
        }
        missing = sorted(name for name, value in required.items() if not value.strip())
        if missing:
            raise ValueError(f"Missing production settings: {', '.join(missing)}")

        origins = self.allowed_origins
        if not origins:
            raise ValueError("CORS_ORIGINS must contain at least one production origin")
        for origin in [*origins, self.frontend_url.rstrip("/")]:
            parsed = urlsplit(origin)
            if (
                parsed.scheme != "https"
                or not parsed.hostname
                or parsed.username is not None
                or parsed.password is not None
                or parsed.path not in {"", "/"}
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError("Production web origins must be exact HTTPS origins")
        frontend_origin = self.frontend_url.rstrip("/")
        if frontend_origin not in origins:
            raise ValueError("FRONTEND_URL must be included in CORS_ORIGINS")

        supabase_base = self.supabase_url.rstrip("/")
        if not supabase_base.startswith("https://"):
            raise ValueError("Production SUPABASE_URL must use HTTPS")
        expected_issuer = f"{supabase_base}/auth/v1"
        if self.supabase_jwt_issuer.rstrip("/") != expected_issuer:
            raise ValueError("SUPABASE_JWT_ISSUER must match SUPABASE_URL")
        expected_jwks = f"{expected_issuer}/.well-known/jwks.json"
        if self.supabase_jwks_url != expected_jwks:
            raise ValueError("SUPABASE_JWKS_URL must match SUPABASE_URL")
        return self

    @property
    def allowed_origins(self) -> list[str]:
        raw = self.cors_origins.strip()
        if raw.startswith("[") and raw.endswith("]"):
            import json

            values = json.loads(raw)
        else:
            values = raw.split(",")
        origins = [str(value).strip().rstrip("/") for value in values if str(value).strip()]
        if "*" in origins:
            raise ValueError("CORS_ORIGINS must be an explicit allowlist")
        return origins


@lru_cache
def get_settings() -> Settings:
    return Settings()
