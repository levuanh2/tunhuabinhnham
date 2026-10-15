import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Table,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

JSON_DOCUMENT = JSON().with_variant(JSONB(), "postgresql")
AUTH_USERS = Table(
    "users",
    Base.metadata,
    Column("id", Uuid, primary_key=True),
    schema="auth",
    info={"skip_autogenerate": True},
)


class PublishStatus(StrEnum):
    draft = "draft"
    published = "published"


class StockStatus(StrEnum):
    in_stock = "in_stock"
    out_of_stock = "out_of_stock"
    contact = "contact"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class SoftDeleteMixin:
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AdminUser(Base, TimestampMixin):
    __tablename__ = "admin_users"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    auth_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("auth.users.id", ondelete="CASCADE"), unique=True
    )
    email: Mapped[str] = mapped_column(String(320), unique=True)
    role: Mapped[str] = mapped_column(String(30), default="admin")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    __table_args__ = (Index("ix_admin_users_auth_user_id", "auth_user_id"),)


class Category(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "categories"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(160))
    slug: Mapped[str] = mapped_column(String(180), unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(Text)
    is_visible: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    products: Mapped[list["Product"]] = relationship(back_populates="category")
    __table_args__ = (
        Index("ix_categories_slug", "slug"),
        Index("ix_categories_visible", "is_visible", postgresql_where=text("deleted_at is null")),
    )


class Product(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "products"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL")
    )
    name: Mapped[str] = mapped_column(String(240))
    slug: Mapped[str] = mapped_column(String(260), unique=True)
    sku: Mapped[str] = mapped_column(String(80), unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    price: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    stock_status: Mapped[StockStatus] = mapped_column(
        Enum(StockStatus, name="stock_status"), default=StockStatus.contact
    )
    publish_status: Mapped[PublishStatus] = mapped_column(
        Enum(PublishStatus, name="publish_status"), default=PublishStatus.draft
    )
    is_visible: Mapped[bool] = mapped_column(Boolean, default=True)
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False)
    attributes: Mapped[dict[str, Any]] = mapped_column(JSON_DOCUMENT, default=dict)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    category: Mapped[Category | None] = relationship(back_populates="products")
    images: Mapped[list["ProductImage"]] = relationship(
        back_populates="product", cascade="all, delete-orphan", order_by="ProductImage.sort_order"
    )
    __table_args__ = (
        Index("ix_products_public", "publish_status", "is_visible", "deleted_at", "published_at"),
        Index("ix_products_category", "category_id"),
        Index(
            "ix_products_name_search",
            text("to_tsvector('simple', name)"),
            postgresql_using="gin",
        ).ddl_if(dialect="postgresql"),
    )


class ProductSlug(Base):
    """Every URL slug a product has had since it was first public, including the current one.

    The unique slug is what keeps an old URL pointing at one product forever.
    """

    __tablename__ = "product_slugs"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    slug: Mapped[str] = mapped_column(String(260), unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    __table_args__ = (Index("ix_product_slugs_product_id", "product_id"),)


class ProductImage(Base, TimestampMixin):
    __tablename__ = "product_images"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE")
    )
    storage_key: Mapped[str] = mapped_column(Text, unique=True)
    url: Mapped[str] = mapped_column(Text)
    alt_text: Mapped[str | None] = mapped_column(String(300))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    product: Mapped[Product] = relationship(back_populates="images")
    __table_args__ = (
        UniqueConstraint("product_id", "sort_order"),
        Index(
            "uq_product_primary_image",
            "product_id",
            unique=True,
            postgresql_where=text("is_primary"),
            sqlite_where=text("is_primary"),
        ),
    )


class Post(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "posts"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(260))
    slug: Mapped[str] = mapped_column(String(280), unique=True)
    excerpt: Mapped[str | None] = mapped_column(Text)
    content_json: Mapped[dict[str, Any]] = mapped_column(JSON_DOCUMENT, default=dict)
    content_html: Mapped[str] = mapped_column(Text, default="")
    cover_image_url: Mapped[str | None] = mapped_column(Text)
    publish_status: Mapped[PublishStatus] = mapped_column(
        Enum(PublishStatus, name="post_publish_status"), default=PublishStatus.draft
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    seo_title: Mapped[str | None] = mapped_column(String(260))
    seo_description: Mapped[str | None] = mapped_column(String(320))
    images: Mapped[list["PostImage"]] = relationship(
        back_populates="post", cascade="all, delete-orphan", order_by="PostImage.sort_order"
    )
    __table_args__ = (Index("ix_posts_public", "publish_status", "deleted_at", "published_at"),)


class PostImage(Base, TimestampMixin):
    __tablename__ = "post_images"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    post_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"))
    storage_key: Mapped[str] = mapped_column(Text, unique=True)
    url: Mapped[str] = mapped_column(Text)
    alt_text: Mapped[str | None] = mapped_column(String(300))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    post: Mapped[Post] = relationship(back_populates="images")
    __table_args__ = (
        UniqueConstraint("post_id", "sort_order"),
        Index("ix_post_images_post_id", "post_id"),
    )


class Banner(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "banners"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(240))
    subtitle: Mapped[str | None] = mapped_column(Text)
    image_url: Mapped[str] = mapped_column(Text)
    cta_label: Mapped[str | None] = mapped_column(String(80))
    cta_url: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    __table_args__ = (
        Index(
            "ix_banners_active",
            "is_active",
            "sort_order",
            postgresql_where=text("deleted_at is null"),
        ),
    )


class SiteSettings(Base, TimestampMixin):
    __tablename__ = "site_settings"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    store_name: Mapped[str] = mapped_column(String(200), default="Tủ Nhựa Bình Nhâm")
    logo_url: Mapped[str | None] = mapped_column(Text)
    favicon_url: Mapped[str | None] = mapped_column(Text)
    facebook_url: Mapped[str] = mapped_column(Text, default="https://facebook.com")
    messenger_url: Mapped[str | None] = mapped_column(Text)
    hotline: Mapped[str | None] = mapped_column(String(50))
    address: Mapped[str | None] = mapped_column(Text)
    about_text: Mapped[str] = mapped_column(Text, default="")
    default_seo_title: Mapped[str | None] = mapped_column(String(260))
    default_seo_description: Mapped[str | None] = mapped_column(String(320))
    contact_tracking_enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class ContactClick(Base):
    __tablename__ = "contact_clicks"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL")
    )
    source: Mapped[str] = mapped_column(String(80), default="unknown")
    ip_hash: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    __table_args__ = (
        Index("ix_contact_clicks_created", "created_at"),
        Index("ix_contact_clicks_product_id", "product_id"),
    )


class MediaAsset(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "media_assets"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    storage_key: Mapped[str] = mapped_column(Text, unique=True)
    bucket: Mapped[str] = mapped_column(String(80))
    public_url: Mapped[str] = mapped_column(Text)
    mime_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(Integer)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("admin_users.id", ondelete="SET NULL")
    )
    __table_args__ = (Index("ix_media_assets_uploaded_by", "uploaded_by"),)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    admin_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("admin_users.id", ondelete="SET NULL")
    )
    action: Mapped[str] = mapped_column(String(80))
    entity_type: Mapped[str] = mapped_column(String(80))
    entity_id: Mapped[uuid.UUID | None] = mapped_column()
    changes: Mapped[dict[str, Any]] = mapped_column(JSON_DOCUMENT, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    __table_args__ = (
        Index("ix_audit_entity", "entity_type", "entity_id", "created_at"),
        Index("ix_audit_logs_admin_user_id", "admin_user_id"),
    )
