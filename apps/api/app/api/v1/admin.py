import logging
import uuid
from datetime import UTC, datetime
from typing import cast

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.auth import CurrentAdmin, require_admin, require_rate_limited_admin
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import (
    AuditLog,
    Banner,
    Category,
    ContactClick,
    MediaAsset,
    Post,
    PostImage,
    Product,
    ProductImage,
    PublishStatus,
    SiteSettings,
)
from app.repositories.catalog import CategoryRepository, ProductRepository
from app.schemas.catalog import (
    CategoryCreate,
    CategoryOut,
    CategoryUpdate,
    ProductCreate,
    ProductOut,
    ProductUpdate,
)
from app.schemas.common import Page
from app.schemas.content import (
    BannerCreate,
    BannerOut,
    BannerUpdate,
    PostCreate,
    PostOut,
    PostUpdate,
    SiteSettingsOut,
    SiteSettingsUpdate,
)
from app.services.catalog import CatalogService

router = APIRouter(dependencies=[Depends(require_rate_limited_admin)])
logger = logging.getLogger(__name__)


def missing(name: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"{name} not found")


@router.get("/products", response_model=Page[ProductOut])
def list_products(
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = None,
) -> Page[ProductOut]:
    items, total = ProductRepository(db).list(
        public=False, page=page, page_size=page_size, search=search
    )
    return Page[ProductOut].create(
        [ProductOut.model_validate(item) for item in items], page, page_size, total
    )


@router.post("/products", response_model=ProductOut, status_code=201)
def create_product(
    data: ProductCreate, db: Session = Depends(get_db), admin: CurrentAdmin = Depends(require_admin)
) -> ProductOut:
    return ProductOut.model_validate(CatalogService(db).create_product(data, admin.id))


@router.get("/products/{item_id}", response_model=ProductOut)
def get_product(item_id: uuid.UUID, db: Session = Depends(get_db)) -> ProductOut:
    item = ProductRepository(db).get(item_id)
    if item is None:
        raise missing("Product")
    return ProductOut.model_validate(item)


@router.patch("/products/{item_id}", response_model=ProductOut)
def update_product(
    item_id: uuid.UUID,
    data: ProductUpdate,
    db: Session = Depends(get_db),
    admin: CurrentAdmin = Depends(require_admin),
) -> ProductOut:
    item = ProductRepository(db).get(item_id)
    if item is None:
        raise missing("Product")
    return ProductOut.model_validate(CatalogService(db).update_product(item, data, admin.id))


@router.delete("/products/{item_id}", status_code=204)
def delete_product(
    item_id: uuid.UUID, db: Session = Depends(get_db), admin: CurrentAdmin = Depends(require_admin)
) -> None:
    item = ProductRepository(db).get(item_id)
    if item is None:
        raise missing("Product")
    CatalogService(db).delete_product(item, admin.id)


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(db: Session = Depends(get_db)) -> list[CategoryOut]:
    return [CategoryOut.model_validate(item) for item in CategoryRepository(db).admin_list()]


@router.post("/categories", response_model=CategoryOut, status_code=201)
def create_category(
    data: CategoryCreate,
    db: Session = Depends(get_db),
    admin: CurrentAdmin = Depends(require_admin),
) -> CategoryOut:
    return CategoryOut.model_validate(CatalogService(db).create_category(data, admin.id))


@router.patch("/categories/{item_id}", response_model=CategoryOut)
def update_category(
    item_id: uuid.UUID,
    data: CategoryUpdate,
    db: Session = Depends(get_db),
    admin: CurrentAdmin = Depends(require_admin),
) -> CategoryOut:
    item = CategoryRepository(db).get(item_id)
    if item is None:
        raise missing("Category")
    return CategoryOut.model_validate(CatalogService(db).update_category(item, data, admin.id))


@router.delete("/categories/{item_id}", status_code=204)
def delete_category(
    item_id: uuid.UUID, db: Session = Depends(get_db), admin: CurrentAdmin = Depends(require_admin)
) -> None:
    item = CategoryRepository(db).get(item_id)
    if item is None:
        raise missing("Category")
    CatalogService(db).delete_category(item, admin.id)


def _sanitize(html: str) -> str:
    # Bleach is the production sanitizer. Importing lazily keeps schema tooling usable
    # before optional runtime dependencies are installed.
    try:
        import bleach  # type: ignore[import-untyped]
    except ImportError as exc:
        raise HTTPException(status_code=503, detail="HTML sanitizer is not installed") from exc
    return cast(str, bleach.clean(
        html,
        tags={
            "p",
            "h2",
            "h3",
            "h4",
            "ul",
            "ol",
            "li",
            "strong",
            "em",
            "blockquote",
            "a",
            "br",
            "img",
        },
        attributes={"a": ["href", "target", "rel"], "img": ["src", "alt"]},
        protocols={"http", "https"},
    ))


@router.get("/posts", response_model=list[PostOut])
def list_posts(db: Session = Depends(get_db)) -> list[PostOut]:
    return [
        PostOut.model_validate(item)
        for item in db.scalars(
            select(Post)
            .options(selectinload(Post.images))
            .where(Post.deleted_at.is_(None))
            .order_by(Post.updated_at.desc())
        )
    ]


@router.post("/posts", response_model=PostOut, status_code=201)
def create_post(
    data: PostCreate, db: Session = Depends(get_db), admin: CurrentAdmin = Depends(require_admin)
) -> PostOut:
    values = data.model_dump(exclude={"images"})
    values["content_html"] = _sanitize(values["content_html"])
    if values["publish_status"] == PublishStatus.published and values["published_at"] is None:
        values["published_at"] = datetime.now(UTC)
    item = Post(**values)
    item.images = [PostImage(**image.model_dump()) for image in data.images]
    db.add(item)
    db.flush()
    db.add(AuditLog(admin_user_id=admin.id, action="create", entity_type="post", entity_id=item.id))
    db.commit()
    db.refresh(item)
    return PostOut.model_validate(item)


@router.patch("/posts/{item_id}", response_model=PostOut)
def update_post(
    item_id: uuid.UUID,
    data: PostUpdate,
    db: Session = Depends(get_db),
    admin: CurrentAdmin = Depends(require_admin),
) -> PostOut:
    item = db.scalar(select(Post).where(Post.id == item_id, Post.deleted_at.is_(None)))
    if item is None:
        raise missing("Post")
    changes = data.model_dump(exclude_unset=True, exclude={"images"})
    if "content_html" in changes:
        changes["content_html"] = _sanitize(changes["content_html"])
    for key, value in changes.items():
        setattr(item, key, value)
    if data.images is not None:
        existing = {image.storage_key: image for image in item.images}
        current_max = max((image.sort_order for image in item.images), default=-1)
        requested_max = max((image.sort_order for image in data.images), default=-1)
        temporary_order = max(current_max, requested_max) + 1
        for image in item.images:
            image.sort_order = temporary_order
            temporary_order += 1
        db.flush()

        reconciled: list[PostImage] = []
        for image_data in data.images:
            reconciled_image = (
                existing.pop(image_data.storage_key)
                if image_data.storage_key in existing
                else None
            )
            if reconciled_image is None:
                reconciled_image = PostImage(**image_data.model_dump())
            else:
                for key, value in image_data.model_dump().items():
                    setattr(reconciled_image, key, value)
            reconciled.append(reconciled_image)
        item.images[:] = reconciled
    if item.publish_status == PublishStatus.published and item.published_at is None:
        item.published_at = datetime.now(UTC)
    db.add(AuditLog(admin_user_id=admin.id, action="update", entity_type="post", entity_id=item.id))
    db.commit()
    db.refresh(item)
    return PostOut.model_validate(item)


@router.delete("/posts/{item_id}", status_code=204)
def delete_post(
    item_id: uuid.UUID, db: Session = Depends(get_db), admin: CurrentAdmin = Depends(require_admin)
) -> None:
    item = db.scalar(select(Post).where(Post.id == item_id, Post.deleted_at.is_(None)))
    if item is None:
        raise missing("Post")
    item.deleted_at = datetime.now(UTC)
    db.add(AuditLog(admin_user_id=admin.id, action="delete", entity_type="post", entity_id=item.id))
    db.commit()


@router.get("/banners", response_model=list[BannerOut])
def list_banners(db: Session = Depends(get_db)) -> list[BannerOut]:
    return [
        BannerOut.model_validate(item)
        for item in db.scalars(
            select(Banner).where(Banner.deleted_at.is_(None)).order_by(Banner.sort_order)
        )
    ]


@router.post("/banners", response_model=BannerOut, status_code=201)
def create_banner(
    data: BannerCreate, db: Session = Depends(get_db), admin: CurrentAdmin = Depends(require_admin)
) -> BannerOut:
    item = Banner(**data.model_dump())
    db.add(item)
    db.flush()
    db.add(
        AuditLog(admin_user_id=admin.id, action="create", entity_type="banner", entity_id=item.id)
    )
    db.commit()
    db.refresh(item)
    return BannerOut.model_validate(item)


@router.patch("/banners/{item_id}", response_model=BannerOut)
def update_banner(
    item_id: uuid.UUID,
    data: BannerUpdate,
    db: Session = Depends(get_db),
    admin: CurrentAdmin = Depends(require_admin),
) -> BannerOut:
    item = db.scalar(select(Banner).where(Banner.id == item_id, Banner.deleted_at.is_(None)))
    if item is None:
        raise missing("Banner")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    db.add(
        AuditLog(admin_user_id=admin.id, action="update", entity_type="banner", entity_id=item.id)
    )
    db.commit()
    db.refresh(item)
    return BannerOut.model_validate(item)


@router.delete("/banners/{item_id}", status_code=204)
def delete_banner(
    item_id: uuid.UUID, db: Session = Depends(get_db), admin: CurrentAdmin = Depends(require_admin)
) -> None:
    item = db.scalar(select(Banner).where(Banner.id == item_id, Banner.deleted_at.is_(None)))
    if item is None:
        raise missing("Banner")
    item.deleted_at = datetime.now(UTC)
    item.is_active = False
    db.add(
        AuditLog(admin_user_id=admin.id, action="delete", entity_type="banner", entity_id=item.id)
    )
    db.commit()


@router.get("/site-settings", response_model=SiteSettingsOut)
def get_settings_route(db: Session = Depends(get_db)) -> SiteSettingsOut:
    item = db.scalar(select(SiteSettings).limit(1))
    if item is None:
        raise missing("Site settings")
    return SiteSettingsOut.model_validate(item)


@router.patch("/site-settings", response_model=SiteSettingsOut)
def update_settings(
    data: SiteSettingsUpdate,
    db: Session = Depends(get_db),
    admin: CurrentAdmin = Depends(require_admin),
) -> SiteSettingsOut:
    item = db.scalar(select(SiteSettings).limit(1))
    if item is None:
        item = SiteSettings(store_name="Tủ Nhựa Bình Nhâm", facebook_url="https://facebook.com")
        db.add(item)
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    db.flush()
    db.add(
        AuditLog(
            admin_user_id=admin.id, action="update", entity_type="site_settings", entity_id=item.id
        )
    )
    db.commit()
    db.refresh(item)
    return SiteSettingsOut.model_validate(item)


@router.get("/dashboard/stats")
def dashboard(db: Session = Depends(get_db)) -> dict[str, int]:
    return {
        "products": db.scalar(
            select(func.count()).select_from(Product).where(Product.deleted_at.is_(None))
        )
        or 0,
        "categories": db.scalar(
            select(func.count()).select_from(Category).where(Category.deleted_at.is_(None))
        )
        or 0,
        "posts": db.scalar(select(func.count()).select_from(Post).where(Post.deleted_at.is_(None)))
        or 0,
        "visible_products": db.scalar(
            select(func.count())
            .select_from(Product)
            .where(
                Product.deleted_at.is_(None),
                Product.is_visible.is_(True),
                Product.publish_status == PublishStatus.published,
            )
        )
        or 0,
        "contact_clicks": db.scalar(select(func.count()).select_from(ContactClick)) or 0,
    }


ALLOWED_BUCKETS = {"product-images", "post-images", "banners", "branding"}
MIME_SIGNATURES = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/x-icon": (b"\x00\x00\x01\x00",),
}


def _valid_image_signature(mime: str, content: bytes) -> bool:
    if mime == "image/webp":
        return len(content) >= 12 and content.startswith(b"RIFF") and content[8:12] == b"WEBP"
    return any(content.startswith(signature) for signature in MIME_SIGNATURES.get(mime, ()))


@router.post("/media", status_code=201)
async def upload_media(
    bucket: str = Query(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: CurrentAdmin = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> dict[str, str]:
    if bucket not in ALLOWED_BUCKETS:
        raise HTTPException(status_code=422, detail="Unsupported media bucket")
    content = await file.read(settings.max_upload_bytes + 1)
    if not content:
        raise HTTPException(status_code=422, detail="File is empty")
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="File is too large")
    mime = file.content_type or ""
    allowed_mimes = {"image/jpeg", "image/png", "image/webp"}
    if bucket == "branding":
        allowed_mimes.add("image/x-icon")
    if mime not in allowed_mimes or not _valid_image_signature(mime, content):
        raise HTTPException(status_code=415, detail="Unsupported or invalid image")
    if not settings.supabase_url or not settings.supabase_secret_key:
        raise HTTPException(status_code=503, detail="Supabase Storage is not configured")
    extension = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/x-icon": "ico",
    }[mime]
    storage_key = f"{datetime.now(UTC):%Y/%m}/{uuid.uuid4()}.{extension}"
    try:
        from supabase import create_client
    except ImportError as exc:
        raise HTTPException(
            status_code=503, detail="Supabase Storage client is not installed"
        ) from exc
    client = create_client(settings.supabase_url, settings.supabase_secret_key)
    storage = client.storage.from_(bucket)
    try:
        storage.upload(
            storage_key,
            content,
            {"content-type": mime, "cache-control": "31536000", "upsert": "false"},
        )
        public_url = storage.get_public_url(storage_key)
    except Exception as exc:
        logger.warning("storage_upload_failed bucket=%s", bucket)
        raise HTTPException(status_code=502, detail="Media storage upload failed") from exc
    asset = MediaAsset(
        storage_key=storage_key,
        bucket=bucket,
        public_url=public_url,
        mime_type=mime,
        size_bytes=len(content),
        uploaded_by=admin.id,
    )
    try:
        db.add(asset)
        db.flush()
        db.add(
            AuditLog(
                admin_user_id=admin.id,
                action="upload",
                entity_type="media",
                entity_id=asset.id,
                changes={"storage_key": storage_key, "bucket": bucket},
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        try:
            storage.remove([storage_key])
        except Exception:
            logger.error("storage_compensation_failed bucket=%s", bucket)
        raise
    return {
        "id": str(asset.id),
        "url": public_url,
        "storage_key": storage_key,
        "bucket": bucket,
    }


def _media_is_referenced(db: Session, asset: MediaAsset) -> bool:
    references = (
        select(ProductImage.id).where(ProductImage.storage_key == asset.storage_key).limit(1),
        select(PostImage.id).where(PostImage.storage_key == asset.storage_key).limit(1),
        select(Category.id).where(Category.image_url == asset.public_url).limit(1),
        select(Post.id).where(Post.cover_image_url == asset.public_url).limit(1),
        select(Banner.id).where(Banner.image_url == asset.public_url).limit(1),
        select(SiteSettings.id)
        .where(
            (SiteSettings.logo_url == asset.public_url)
            | (SiteSettings.favicon_url == asset.public_url)
        )
        .limit(1),
    )
    return any(db.scalar(query) is not None for query in references)


def _delete_media_asset(
    asset: MediaAsset, db: Session, admin: CurrentAdmin, settings: Settings
) -> None:
    if _media_is_referenced(db, asset):
        raise HTTPException(status_code=409, detail="Media is still referenced by content")
    if not settings.supabase_url or not settings.supabase_secret_key:
        raise HTTPException(status_code=503, detail="Supabase Storage is not configured")
    try:
        from supabase import create_client

        create_client(settings.supabase_url, settings.supabase_secret_key).storage.from_(
            asset.bucket
        ).remove([asset.storage_key])
    except Exception as exc:
        logger.warning("storage_delete_failed bucket=%s", asset.bucket)
        raise HTTPException(status_code=502, detail="Media storage deletion failed") from exc
    asset.deleted_at = datetime.now(UTC)
    db.add(
        AuditLog(
            admin_user_id=admin.id,
            action="delete",
            entity_type="media",
            entity_id=asset.id,
            changes={"storage_key": asset.storage_key, "bucket": asset.bucket},
        )
    )
    db.commit()


@router.delete("/media", status_code=204)
def delete_media_by_url(
    url: str = Query(..., min_length=1, max_length=2000),
    db: Session = Depends(get_db),
    admin: CurrentAdmin = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> None:
    """Delete an unreferenced managed asset after a content update removed its URL."""
    asset = db.scalar(
        select(MediaAsset).where(MediaAsset.public_url == url, MediaAsset.deleted_at.is_(None))
    )
    if asset is None:
        raise missing("Media")
    _delete_media_asset(asset, db, admin, settings)


@router.delete("/media/{asset_id}", status_code=204)
def delete_media(
    asset_id: uuid.UUID,
    db: Session = Depends(get_db),
    admin: CurrentAdmin = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> None:
    asset = db.scalar(
        select(MediaAsset).where(MediaAsset.id == asset_id, MediaAsset.deleted_at.is_(None))
    )
    if asset is None:
        raise missing("Media")
    _delete_media_asset(asset, db, admin, settings)
