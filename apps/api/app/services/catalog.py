import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.conflicts import integrity_conflict
from app.models import AuditLog, Category, Product, ProductImage, ProductSlug, PublishStatus
from app.repositories.catalog import CategoryRepository, ProductRepository
from app.schemas.catalog import CategoryCreate, CategoryUpdate, ProductCreate, ProductUpdate


class CatalogService:
    def __init__(self, db: Session):
        self.db = db
        self.products = ProductRepository(db)
        self.categories = CategoryRepository(db)

    def create_category(self, data: CategoryCreate, admin_id: uuid.UUID) -> Category:
        item = Category(**data.model_dump())
        self.db.add(item)
        self.db.add(
            AuditLog(
                admin_user_id=admin_id,
                action="create",
                entity_type="category",
                entity_id=item.id,
                changes=data.model_dump(mode="json"),
            )
        )
        try:
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise integrity_conflict(exc) from exc
        self.db.refresh(item)
        return item

    def update_category(
        self, item: Category, data: CategoryUpdate, admin_id: uuid.UUID
    ) -> Category:
        changes = data.model_dump(exclude_unset=True)
        for key, value in changes.items():
            setattr(item, key, value)
        self.db.add(
            AuditLog(
                admin_user_id=admin_id,
                action="update",
                entity_type="category",
                entity_id=item.id,
                changes=changes,
            )
        )
        try:
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise integrity_conflict(exc) from exc
        self.db.refresh(item)
        return item

    def _require_live_category(self, category_id: uuid.UUID | None) -> None:
        """Products may only point at a category that is not deleted.

        FOR SHARE (PostgreSQL) makes a concurrent delete_category wait for this transaction,
        and makes this one wait for a delete that already holds the row, so neither side can
        slip between the other's check and commit.
        """
        if category_id is None:
            return
        live = self.db.scalar(
            select(Category.id)
            .where(Category.id == category_id, Category.deleted_at.is_(None))
            .with_for_update(read=True)
        )
        if live is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Category not found"
            )

    def delete_category(self, item: Category, admin_id: uuid.UUID) -> None:
        # Products keep category_id after a soft delete, so a deleted category would stay
        # attached to them. Admins move or delete the products first. The row lock pairs
        # with _require_live_category, so a product assigned concurrently is either counted
        # here or refused there.
        self.db.refresh(item, with_for_update=True)
        in_use = self.db.scalar(
            select(func.count())
            .select_from(Product)
            .where(Product.category_id == item.id, Product.deleted_at.is_(None))
        )
        if in_use:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Category has products")
        item.deleted_at = datetime.now(UTC)
        item.is_visible = False
        self.db.add(
            AuditLog(
                admin_user_id=admin_id, action="delete", entity_type="category", entity_id=item.id
            )
        )
        self.db.commit()

    def _require_free_slug(self, slug: str, product_id: uuid.UUID | None) -> bool:
        """True when the product already owns this slug (now or in its history).

        A slug, current or old, belongs to one product forever, so an old URL can never start
        showing another product. The unique key on product_slugs.slug settles two saves racing
        for the same free slug: the second gets an IntegrityError, mapped to the same 409.
        """
        owner = self.db.scalar(select(ProductSlug.product_id).where(ProductSlug.slug == slug))
        if owner is not None and owner != product_id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Slug already exists")
        return owner is not None

    def create_product(self, data: ProductCreate, admin_id: uuid.UUID) -> Product:
        values = data.model_dump(exclude={"images"})
        self._require_live_category(data.category_id)
        self._require_free_slug(data.slug, None)
        item = Product(**values)
        if item.publish_status == PublishStatus.published and item.published_at is None:
            item.published_at = datetime.now(UTC)
        item.images = [ProductImage(**image.model_dump()) for image in data.images]
        self.db.add(item)
        try:
            self.db.flush()
            self.db.add(ProductSlug(product_id=item.id, slug=item.slug))
            self.db.add(
                AuditLog(
                    admin_user_id=admin_id,
                    action="create",
                    entity_type="product",
                    entity_id=item.id,
                    changes={"name": item.name, "sku": item.sku},
                )
            )
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise integrity_conflict(exc) from exc
        return self.products.get(item.id) or item

    def update_product(self, item: Product, data: ProductUpdate, admin_id: uuid.UUID) -> Product:
        changes = data.model_dump(exclude_unset=True, exclude={"images"})
        # Re-read under a row lock: another admin may have published it since this form loaded.
        self.db.refresh(item, with_for_update=True)
        was_public = item.published_at is not None or item.publish_status == PublishStatus.published
        if was_public and "published_at" in changes and changes["published_at"] is None:
            # published_at records that the URL was public, which is what keeps it as a redirect.
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Published date cannot be cleared"
            )
        previous_slug = item.slug
        new_slug = changes.get("slug", previous_slug)
        # Checked before anything changes, so a refused rename leaves the product as it was.
        new_slug_owned = new_slug != previous_slug and self._require_free_slug(new_slug, item.id)
        if "category_id" in changes:
            self._require_live_category(changes["category_id"])
        for key, value in changes.items():
            setattr(item, key, value)
        if (
            "publish_status" in changes
            and item.publish_status == PublishStatus.published
            and item.published_at is None
        ):
            item.published_at = datetime.now(UTC)
        try:
            if new_slug != previous_slug:
                if not was_public:
                    # Never public, so nobody can have the old URL: free it (typos in drafts).
                    self.db.execute(
                        delete(ProductSlug).where(
                            ProductSlug.slug == previous_slug, ProductSlug.product_id == item.id
                        )
                    )
                elif not self._require_free_slug(previous_slug, item.id):
                    # Products created before product_slugs existed are backfilled by the
                    # migration; this keeps any other writer's product redirectable too.
                    self.db.add(ProductSlug(product_id=item.id, slug=previous_slug))
                if not new_slug_owned:
                    self.db.add(ProductSlug(product_id=item.id, slug=new_slug))
            if data.images is not None:
                existing = {image.storage_key: image for image in item.images}
                current_max = max((image.sort_order for image in item.images), default=-1)
                requested_max = max((image.sort_order for image in data.images), default=-1)
                temporary_order = max(current_max, requested_max) + 1
                for image in item.images:
                    image.sort_order = temporary_order
                    image.is_primary = False
                    temporary_order += 1
                self.db.flush()

                reconciled: list[ProductImage] = []
                for image_data in data.images:
                    reconciled_image = (
                        existing.pop(image_data.storage_key)
                        if image_data.storage_key in existing
                        else None
                    )
                    if reconciled_image is None:
                        reconciled_image = ProductImage(**image_data.model_dump())
                    else:
                        for key, value in image_data.model_dump().items():
                            setattr(reconciled_image, key, value)
                    reconciled.append(reconciled_image)
                item.images[:] = reconciled
            self.db.add(
                AuditLog(
                    admin_user_id=admin_id,
                    action="update",
                    entity_type="product",
                    entity_id=item.id,
                    changes={
                        **{key: str(value) for key, value in changes.items()},
                        **({"previous_slug": previous_slug} if new_slug != previous_slug else {}),
                    },
                )
            )
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise integrity_conflict(exc) from exc
        return self.products.get(item.id) or item

    def delete_product(self, item: Product, admin_id: uuid.UUID) -> None:
        item.deleted_at = datetime.now(UTC)
        item.is_visible = False
        self.db.add(
            AuditLog(
                admin_user_id=admin_id, action="delete", entity_type="product", entity_id=item.id
            )
        )
        self.db.commit()
