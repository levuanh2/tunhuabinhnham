import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.sql.base import ExecutableOption
from sqlalchemy.sql.elements import ColumnElement

from app.models import Category, Product, ProductSlug, PublishStatus


def public_product_conditions() -> list[ColumnElement[bool]]:
    """What makes a product visible on the public site (lists, search, filters, detail, sitemap)."""
    return [
        Product.deleted_at.is_(None),
        Product.publish_status == PublishStatus.published,
        Product.is_visible.is_(True),
        or_(Product.published_at.is_(None), Product.published_at <= datetime.now(UTC)),
        # A product in a hidden category is hidden too, without changing its own publish
        # settings. A soft-deleted category counts as hidden (legacy rows deleted before the
        # delete guard may still point at one).
        or_(
            Product.category_id.is_(None),
            Product.category.has(and_(Category.deleted_at.is_(None), Category.is_visible.is_(True))),
        ),
    ]


class CategoryRepository:
    def __init__(self, db: Session):
        self.db = db

    def public_list(self) -> list[Category]:
        return list(
            self.db.scalars(
                select(Category)
                .where(Category.deleted_at.is_(None), Category.is_visible.is_(True))
                .order_by(Category.sort_order, Category.name)
            )
        )

    def admin_list(self) -> list[Category]:
        return list(
            self.db.scalars(
                select(Category)
                .where(Category.deleted_at.is_(None))
                .order_by(Category.sort_order, Category.name)
            )
        )

    def get(self, category_id: uuid.UUID) -> Category | None:
        return self.db.scalar(
            select(Category).where(Category.id == category_id, Category.deleted_at.is_(None))
        )

    def by_slug(self, slug: str, public: bool = True) -> Category | None:
        query = select(Category).where(Category.slug == slug, Category.deleted_at.is_(None))
        if public:
            query = query.where(Category.is_visible.is_(True))
        return self.db.scalar(query)


class ProductRepository:
    def __init__(self, db: Session):
        self.db = db

    @staticmethod
    def eager() -> tuple[ExecutableOption, ...]:
        return (selectinload(Product.images), selectinload(Product.category))

    def public_with_related(self, slug: str, related: int) -> tuple[Product | None, list[Product]]:
        """The public product and up to `related` public products of its category (any category
        if it has none), newest first, itself excluded. One statement with the product first: the
        product page gets both in one request, at the database cost of the product alone."""
        if not related:
            return self.by_slug(slug), []
        target = (
            select(Product.id, Product.category_id)
            .where(Product.slug == slug, *public_product_conditions())
            .subquery()
        )
        target_category = select(target.c.category_id).scalar_subquery()
        same_category = or_(target_category.is_(None), Product.category_id == target_category)
        rows = list(
            self.db.scalars(
                select(Product)
                .options(*self.eager())
                .where(
                    *public_product_conditions(),
                    or_(Product.slug == slug, and_(select(target.c.id).exists(), same_category)),
                )
                .order_by((Product.slug == slug).desc(), Product.published_at.desc(), Product.id)
                .limit(related + 1)
            )
        )
        if not rows or rows[0].slug != slug:
            return None, []
        return rows[0], rows[1:]

    def list(
        self,
        *,
        public: bool,
        page: int,
        page_size: int,
        search: str | None = None,
        category: str | None = None,
        min_price: Decimal | None = None,
        max_price: Decimal | None = None,
        sort: str = "-published_at",
    ) -> tuple[list[Product], int]:
        conditions: list[ColumnElement[bool]] = (
            public_product_conditions() if public else [Product.deleted_at.is_(None)]
        )
        if search:
            conditions.append(Product.name.ilike(f"%{search.strip()}%"))
        if category:
            category_rules = [Category.slug == category, Category.deleted_at.is_(None)]
            if public:
                # Hidden categories are not offered as a public filter.
                category_rules.append(Category.is_visible.is_(True))
            conditions.append(Product.category.has(and_(*category_rules)))
        if min_price is not None:
            conditions.append(Product.price >= min_price)
        if max_price is not None:
            conditions.append(Product.price <= max_price)
        order_map: dict[str, ColumnElement[Any]] = {
            "price": Product.price.asc().nullslast(),
            "-price": Product.price.desc().nullslast(),
            "published_at": Product.published_at.asc(),
            "-published_at": Product.published_at.desc(),
        }
        order = order_map.get(sort, Product.published_at.desc())
        total = self.db.scalar(select(func.count()).select_from(Product).where(*conditions)) or 0
        query = (
            select(Product)
            .options(*self.eager())
            .where(*conditions)
            .order_by(order, Product.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return list(self.db.scalars(query)), total

    def get(self, product_id: uuid.UUID) -> Product | None:
        return self.db.scalar(
            select(Product)
            .options(*self.eager())
            .where(Product.id == product_id, Product.deleted_at.is_(None))
        )

    def by_slug(self, slug: str, public: bool = True) -> Product | None:
        conditions: list[ColumnElement[bool]] = (
            public_product_conditions() if public else [Product.deleted_at.is_(None)]
        )
        conditions.append(Product.slug == slug)
        return self.db.scalar(select(Product).options(*self.eager()).where(*conditions))

    def public_by_old_slug(self, slug: str) -> Product | None:
        """The public product that used to have this slug (its URL changed since)."""
        return self.db.scalar(
            select(Product)
            .options(*self.eager())
            .join(ProductSlug, ProductSlug.product_id == Product.id)
            .where(ProductSlug.slug == slug, Product.slug != slug, *public_product_conditions())
        )
