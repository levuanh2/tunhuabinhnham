from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "apps/api/.env"), extra="ignore")

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

    @field_validator("database_url")
    @classmethod
    def normalize_database_driver(cls, value: str) -> str:
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
        return value

    @model_validator(mode="after")
    def validate_production_settings(self) -> "Settings":
        if self.app_env == "production" and not self.database_url.startswith("postgresql"):
            raise ValueError("Production DATABASE_URL must use PostgreSQL")
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
