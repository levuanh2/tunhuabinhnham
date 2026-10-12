import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.schemas.content import SiteSettingsUpdate


def test_contact_destination_rejects_non_facebook_url() -> None:
    with pytest.raises(ValidationError):
        SiteSettingsUpdate.model_validate(
            {"messenger_url": "https://attacker.example/phishing"}
        )


def test_contact_destination_requires_https() -> None:
    with pytest.raises(ValidationError):
        SiteSettingsUpdate.model_validate({"facebook_url": "http://facebook.com/shop"})


def test_contact_destination_rejects_embedded_credentials() -> None:
    with pytest.raises(ValidationError):
        SiteSettingsUpdate.model_validate(
            {"facebook_url": "https://user:password@facebook.com/shop"}
        )


def test_contact_destination_accepts_messenger_url() -> None:
    value = SiteSettingsUpdate.model_validate({"messenger_url": "https://m.me/example"})
    assert value.messenger_url == "https://m.me/example"


def _production_settings() -> dict[str, object]:
    return {
        "APP_ENV": "production",
        "DATABASE_URL": "postgresql+psycopg://postgres:password@db.example.com/postgres",
        "CORS_ORIGINS": "https://example.com,https://www.example.com",
        "FRONTEND_URL": "https://example.com",
        "SUPABASE_URL": "https://project.supabase.co",
        "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_test",
        "SUPABASE_SECRET_KEY": "sb_secret_test",
        "SUPABASE_JWT_ISSUER": "https://project.supabase.co/auth/v1",
        "SUPABASE_JWKS_URL": (
            "https://project.supabase.co/auth/v1/.well-known/jwks.json"
        ),
    }


def test_production_settings_accept_complete_exact_origins() -> None:
    settings = Settings.model_validate(_production_settings())
    assert settings.allowed_origins == ["https://example.com", "https://www.example.com"]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("SUPABASE_SECRET_KEY", ""),
        ("CORS_ORIGINS", "https://example.com/path"),
        ("FRONTEND_URL", "http://example.com"),
        ("SUPABASE_JWT_ISSUER", "https://other.supabase.co/auth/v1"),
        ("SUPABASE_JWKS_URL", "https://other.supabase.co/auth/v1/.well-known/jwks.json"),
    ],
)
def test_production_settings_fail_fast_on_invalid_security_config(
    field: str, value: str
) -> None:
    values = _production_settings()
    values[field] = value

    with pytest.raises(ValidationError):
        Settings.model_validate(values)
