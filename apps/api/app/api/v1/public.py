import ipaddress
from datetime import UTC, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.config import Settings, get_settings
from app.core.rate_limit import (
    ContactClickRepeated,
    ContactQuotaExceeded,
    contact_click_quota,
    contact_client_rate_limiter,
)
from app.db.session import get_db
from app.models import Banner, ContactClick, Post, Product, PublishStatus, SiteSettings
from app.repositories.catalog import (
    CategoryRepository,
    ProductRepository,
    public_product_conditions,
)
from app.schemas.catalog import (
    CategoryOut,
    ContactClickCreate,
    ContactClickOut,
    ProductDetailOut,
    ProductOut,
)
from app.schemas.common import Page
from app.schemas.content import BannerOut, PostOut, SiteSettingsOut

router = APIRouter()


@router.get("/products", response_model=Page[ProductOut])
def products(
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None, max_length=160),
    category: str | None = Query(None, max_length=180),
    min_price: Decimal | None = Query(None, ge=0),
    max_price: Decimal | None = Query(None, ge=0),
    sort: str = Query("-published_at", pattern=r"^-?(price|published_at)$"),
) -> Page[ProductOut]:
    if min_price is not None and max_price is not None and min_price > max_price:
        raise HTTPException(status_code=422, detail="min_price must not exceed max_price")
    items, total = ProductRepository(db).list(
        public=True,
        page=page,
        page_size=page_size,
        search=search,
        category=category,
        min_price=min_price,
        max_price=max_price,
        sort=sort,
    )
    return Page[ProductOut].create(
        [ProductOut.model_validate(item) for item in items], page, page_size, total
    )


@router.get(
    "/products/{slug}",
    response_model=ProductDetailOut,
    responses={301: {"description": "Old URL: Location is the product's current URL"}},
)
def product(
    slug: str,
    request: Request,
    related: int = Query(0, ge=0, le=12),
    db: Session = Depends(get_db),
) -> ProductDetailOut | Response:
    repository = ProductRepository(db)
    item, others = repository.public_with_related(slug, related)
    if item is not None:
        out = ProductDetailOut.model_validate(item)
        out.related = [ProductOut.model_validate(other) for other in others]
        return out
    moved = repository.public_by_old_slug(slug)
    if moved is None:
        raise HTTPException(status_code=404, detail="Product not found")
    # The target comes from the database only (a validated slug on a fixed path), never from the
    # request; the query string is carried over as is. Not cached: the product may move again.
    location = request.app.url_path_for("product", slug=moved.slug)
    if request.url.query:
        location += f"?{request.url.query}"
    return RedirectResponse(
        location, status_code=status.HTTP_301_MOVED_PERMANENTLY, headers={"Cache-Control": "no-store"}
    )


@router.get("/categories", response_model=list[CategoryOut])
def categories(db: Session = Depends(get_db)) -> list[CategoryOut]:
    return [CategoryOut.model_validate(item) for item in CategoryRepository(db).public_list()]


@router.get("/categories/{slug}", response_model=CategoryOut)
def category(slug: str, db: Session = Depends(get_db)) -> CategoryOut:
    item = CategoryRepository(db).by_slug(slug)
    if item is None:
        raise HTTPException(status_code=404, detail="Category not found")
    return CategoryOut.model_validate(item)


@router.get("/posts", response_model=Page[PostOut])
def posts(
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> Page[PostOut]:
    conditions = [
        Post.deleted_at.is_(None),
        Post.publish_status == PublishStatus.published,
        or_(Post.published_at.is_(None), Post.published_at <= datetime.now(UTC)),
    ]
    items = list(
        db.scalars(
            select(Post)
            .options(selectinload(Post.images))
            .where(*conditions)
            .order_by(Post.published_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    total = db.scalar(select(func.count()).select_from(Post).where(*conditions)) or 0
    return Page[PostOut].create(
        [PostOut.model_validate(item) for item in items], page, page_size, total
    )


@router.get("/posts/{slug}", response_model=PostOut)
def post(slug: str, db: Session = Depends(get_db)) -> PostOut:
    item = db.scalar(
        select(Post).options(selectinload(Post.images)).where(
            Post.slug == slug,
            Post.deleted_at.is_(None),
            Post.publish_status == PublishStatus.published,
            or_(Post.published_at.is_(None), Post.published_at <= datetime.now(UTC)),
        )
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Post not found")
    return PostOut.model_validate(item)


@router.get("/banners", response_model=list[BannerOut])
def banners(db: Session = Depends(get_db)) -> list[BannerOut]:
    return [
        BannerOut.model_validate(item)
        for item in db.scalars(
            select(Banner)
            .where(Banner.deleted_at.is_(None), Banner.is_active.is_(True))
            .order_by(Banner.sort_order)
        )
    ]


@router.get("/site-settings", response_model=SiteSettingsOut)
def site_settings(db: Session = Depends(get_db)) -> SiteSettingsOut:
    item = db.scalar(select(SiteSettings).limit(1))
    if item is None:
        raise HTTPException(status_code=404, detail="Site settings not configured")
    return SiteSettingsOut.model_validate(item)


def _client_key(request: Request, header: str) -> str:
    """Rate-limit key for the visitor. Only a single, valid IP from the configured edge header
    is trusted; anything else falls back to the socket peer. IPv6 is grouped by /64, which one
    subscriber usually owns."""
    peer = request.client.host if request.client else "unknown"
    raw = request.headers.get(header, "").strip() if header else ""
    try:
        address = ipaddress.ip_address(raw or peer)
    except ValueError:
        try:
            address = ipaddress.ip_address(peer)
        except ValueError:
            return peer
    if address.version == 6:
        return str(ipaddress.ip_network(f"{address}/64", strict=False))
    return str(address)


def _too_many_contact_clicks(retry_after: int) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Too many contact clicks",
        headers={"Retry-After": str(retry_after)},
    )


@router.post(
    "/contact-clicks", response_model=ContactClickOut, status_code=status.HTTP_202_ACCEPTED
)
def track_contact(
    payload: ContactClickCreate,
    request: Request,
    db: Session = Depends(get_db),
    config: Settings = Depends(get_settings),
) -> ContactClickOut:
    # ponytail: in-process limits; correct for the single Render worker, reset on restart or
    # spin-down. A shared store (Redis/DB) is needed before running more than one worker.
    client = _client_key(request, config.client_ip_header)
    # Request rate first: cheap, and it bounds the database lookups below.
    retry_after = contact_client_rate_limiter.retry_after(
        client, config.contact_click_limit_per_minute
    )
    if retry_after is not None:
        raise _too_many_contact_clicks(retry_after)
    settings = db.scalar(select(SiteSettings).limit(1))
    if settings is not None and not settings.contact_tracking_enabled:
        return ContactClickOut(accepted=False)
    if payload.product_id is not None and db.scalar(
        select(Product.id).where(Product.id == payload.product_id, *public_product_conditions())
    ) is None:
        raise HTTPException(status_code=422, detail="Unknown product")
    # Only a click that will be stored takes from the hourly caps (V1-SEC-05); any failure to
    # store it gives back exactly what it took.
    try:
        with contact_click_quota(
            client,
            f"{client}|{payload.product_id}|{payload.source}",
            per_hour=config.contact_click_client_limit_per_hour,
            global_per_hour=config.contact_click_global_limit_per_hour,
            repeat_seconds=config.contact_click_repeat_seconds,
        ):
            # No IP or IP hash is stored: the count is all the dashboard needs.
            db.add(
                ContactClick(
                    product_id=payload.product_id,
                    source=payload.source,
                    user_agent=(request.headers.get("user-agent") or "")[:500],
                )
            )
            try:
                db.commit()
            except IntegrityError:
                # The product was deleted between the check and the insert.
                db.rollback()
                raise HTTPException(status_code=422, detail="Unknown product") from None
    except ContactClickRepeated:
        return ContactClickOut(accepted=False)  # the same click was just counted
    except ContactQuotaExceeded as exc:
        raise _too_many_contact_clicks(exc.retry_after) from None
    return ContactClickOut()
