import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.sql.base import ExecutableOption
from sqlalchemy.sql.elements import ColumnElement

from app.models import Category, Product, PublishStatus


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
        conditions: list[ColumnElement[bool]] = [Product.deleted_at.is_(None)]
        if public:
            conditions += [
                Product.publish_status == PublishStatus.published,
                Product.is_visible.is_(True),
                or_(Product.published_at.is_(None), Product.published_at <= datetime.now(UTC)),
            ]
        if search:
            conditions.append(Product.name.ilike(f"%{search.strip()}%"))
        if category:
            conditions.append(
                Product.category.has(
                    and_(Category.slug == category, Category.deleted_at.is_(None))
                )
            )
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
        conditions: list[ColumnElement[bool]] = [
            Product.slug == slug,
            Product.deleted_at.is_(None),
        ]
        if public:
            conditions += [
                Product.publish_status == PublishStatus.published,
                Product.is_visible.is_(True),
                or_(Product.published_at.is_(None), Product.published_at <= datetime.now(UTC)),
            ]
        return self.db.scalar(select(Product).options(*self.eager()).where(*conditions))
