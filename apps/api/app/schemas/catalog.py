import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models import PublishStatus, StockStatus


class CategoryBase(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=180)
    description: str | None = None
    image_url: str | None = None
    is_visible: bool = True
    sort_order: int = Field(0, ge=0)


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=160)
    slug: str | None = Field(None, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=180)
    description: str | None = None
    image_url: str | None = None
    is_visible: bool | None = None
    sort_order: int | None = Field(None, ge=0)


class CategoryOut(CategoryBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class AdminCategoryOut(CategoryOut):
    product_count: int = 0


class ProductImageInput(BaseModel):
    storage_key: str = Field(min_length=1, max_length=600)
    url: str = Field(min_length=1, max_length=2000)
    alt_text: str | None = Field(None, max_length=300)
    sort_order: int = Field(0, ge=0)
    is_primary: bool = False


class ProductImageOut(ProductImageInput):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID


class ProductBase(BaseModel):
    name: str = Field(min_length=1, max_length=240)
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=260)
    sku: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9._-]+$")
    category_id: uuid.UUID | None = None
    description: str | None = None
    price: Decimal | None = Field(None, ge=0, max_digits=14, decimal_places=2)
    stock_status: StockStatus = StockStatus.contact
    publish_status: PublishStatus = PublishStatus.draft
    is_visible: bool = True
    is_featured: bool = False
    attributes: dict[str, str] = Field(default_factory=dict)
    published_at: datetime | None = None


class ProductCreate(ProductBase):
    images: list[ProductImageInput] = Field(default_factory=list, max_length=20)

    @field_validator("images")
    @classmethod
    def only_one_primary(cls, value: list[ProductImageInput]) -> list[ProductImageInput]:
        if sum(item.is_primary for item in value) > 1:
            raise ValueError("Only one image may be primary")
        if len({item.sort_order for item in value}) != len(value):
            raise ValueError("Image sort_order values must be unique")
        return value


class ProductUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=240)
    slug: str | None = Field(None, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=260)
    sku: str | None = Field(None, min_length=1, max_length=80, pattern=r"^[A-Za-z0-9._-]+$")
    category_id: uuid.UUID | None = None
    description: str | None = None
    price: Decimal | None = Field(None, ge=0, max_digits=14, decimal_places=2)
    stock_status: StockStatus | None = None
    publish_status: PublishStatus | None = None
    is_visible: bool | None = None
    is_featured: bool | None = None
    attributes: dict[str, str] | None = None
    published_at: datetime | None = None
    images: list[ProductImageInput] | None = Field(None, max_length=20)

    @field_validator("images")
    @classmethod
    def only_one_primary(
        cls, value: list[ProductImageInput] | None
    ) -> list[ProductImageInput] | None:
        if value is None:
            return value
        if sum(item.is_primary for item in value) > 1:
            raise ValueError("Only one image may be primary")
        if len({item.sort_order for item in value}) != len(value):
            raise ValueError("Image sort_order values must be unique")
        return value


class ProductOut(ProductBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    category: CategoryOut | None = None
    images: list[ProductImageOut] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class ContactClickCreate(BaseModel):
    product_id: uuid.UUID | None = None
    source: Literal["product_detail", "product_card", "contact_page", "unknown"] = "unknown"


class ContactClickOut(BaseModel):
    accepted: bool = True
