import uuid
from datetime import datetime
from typing import Any
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models import PublishStatus


class PostImageInput(BaseModel):
    storage_key: str = Field(min_length=1, max_length=600)
    url: str = Field(min_length=1, max_length=2000)
    alt_text: str | None = Field(None, max_length=300)
    sort_order: int = Field(0, ge=0)


class PostImageOut(PostImageInput):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID


def _validate_post_images(value: list[PostImageInput] | None) -> list[PostImageInput] | None:
    if value is not None and len({item.sort_order for item in value}) != len(value):
        raise ValueError("Image sort_order values must be unique")
    return value


class PostBase(BaseModel):
    title: str = Field(min_length=1, max_length=260)
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=280)
    excerpt: str | None = None
    content_json: dict[str, Any] = Field(default_factory=dict)
    content_html: str = ""
    cover_image_url: str | None = None
    publish_status: PublishStatus = PublishStatus.draft
    published_at: datetime | None = None
    seo_title: str | None = Field(None, max_length=260)
    seo_description: str | None = Field(None, max_length=320)


class PostCreate(PostBase):
    images: list[PostImageInput] = Field(default_factory=list, max_length=50)

    @field_validator("images")
    @classmethod
    def unique_image_order(cls, value: list[PostImageInput]) -> list[PostImageInput]:
        return _validate_post_images(value) or []


class PostUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=260)
    slug: str | None = Field(None, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=280)
    excerpt: str | None = None
    content_json: dict[str, Any] | None = None
    content_html: str | None = None
    cover_image_url: str | None = None
    publish_status: PublishStatus | None = None
    published_at: datetime | None = None
    seo_title: str | None = Field(None, max_length=260)
    seo_description: str | None = Field(None, max_length=320)
    images: list[PostImageInput] | None = Field(None, max_length=50)

    @field_validator("images")
    @classmethod
    def unique_image_order(
        cls, value: list[PostImageInput] | None
    ) -> list[PostImageInput] | None:
        return _validate_post_images(value)


class PostOut(PostBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    images: list[PostImageOut] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class BannerBase(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    subtitle: str | None = None
    image_url: str
    cta_label: str | None = Field(None, max_length=80)
    cta_url: str | None = None
    is_active: bool = True
    sort_order: int = Field(0, ge=0)


class BannerCreate(BannerBase):
    pass


class BannerUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=240)
    subtitle: str | None = None
    image_url: str | None = None
    cta_label: str | None = Field(None, max_length=80)
    cta_url: str | None = None
    is_active: bool | None = None
    sort_order: int | None = Field(None, ge=0)


class BannerOut(BannerBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


def _facebook_destination(value: str | None) -> str | None:
    if value is None:
        return None
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower()
    allowed = host in {"facebook.com", "m.me", "messenger.com", "fb.me"} or host.endswith(
        (".facebook.com", ".messenger.com")
    )
    if parsed.scheme != "https" or not allowed:
        raise ValueError("Contact destination must be an HTTPS Facebook or Messenger URL")
    return value


class SiteSettingsBase(BaseModel):
    store_name: str = Field(min_length=1, max_length=200)
    logo_url: str | None = None
    favicon_url: str | None = None
    facebook_url: str
    messenger_url: str | None = None
    hotline: str | None = Field(None, max_length=50)
    address: str | None = None
    about_text: str = ""
    default_seo_title: str | None = Field(None, max_length=260)
    default_seo_description: str | None = Field(None, max_length=320)
    contact_tracking_enabled: bool = True

    @field_validator("facebook_url", "messenger_url")
    @classmethod
    def validate_facebook_destination(cls, value: str | None) -> str | None:
        return _facebook_destination(value)


class SiteSettingsUpdate(BaseModel):
    store_name: str | None = Field(None, min_length=1, max_length=200)
    logo_url: str | None = None
    favicon_url: str | None = None
    facebook_url: str | None = None
    messenger_url: str | None = None
    hotline: str | None = Field(None, max_length=50)
    address: str | None = None
    about_text: str | None = None
    default_seo_title: str | None = Field(None, max_length=260)
    default_seo_description: str | None = Field(None, max_length=320)
    contact_tracking_enabled: bool | None = None

    @field_validator("facebook_url", "messenger_url")
    @classmethod
    def validate_facebook_destination(cls, value: str | None) -> str | None:
        return _facebook_destination(value)


class SiteSettingsOut(SiteSettingsBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    updated_at: datetime
