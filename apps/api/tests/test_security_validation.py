import pytest
from pydantic import ValidationError

from app.schemas.content import SiteSettingsUpdate


def test_contact_destination_rejects_non_facebook_url() -> None:
    with pytest.raises(ValidationError):
        SiteSettingsUpdate.model_validate(
            {"messenger_url": "https://attacker.example/phishing"}
        )


def test_contact_destination_requires_https() -> None:
    with pytest.raises(ValidationError):
        SiteSettingsUpdate.model_validate({"facebook_url": "http://facebook.com/shop"})


def test_contact_destination_accepts_messenger_url() -> None:
    value = SiteSettingsUpdate.model_validate({"messenger_url": "https://m.me/example"})
    assert value.messenger_url == "https://m.me/example"
