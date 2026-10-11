import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import AuditLog, Category, Product, ProductImage, PublishStatus
from app.repositories.catalog import CategoryRepository, ProductRepository
from app.schemas.catalog import CategoryCreate, CategoryUpdate, ProductCreate, ProductUpdate


def _conflict(exc: IntegrityError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Slug or SKU already exists")


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
            raise _conflict(exc) from exc
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
            raise _conflict(exc) from exc
        self.db.refresh(item)
        return item

    def delete_category(self, item: Category, admin_id: uuid.UUID) -> None:
        item.deleted_at = datetime.now(UTC)
        item.is_visible = False
        self.db.add(
            AuditLog(
                admin_user_id=admin_id, action="delete", entity_type="category", entity_id=item.id
            )
        )
        self.db.commit()

    def create_product(self, data: ProductCreate, admin_id: uuid.UUID) -> Product:
        values = data.model_dump(exclude={"images"})
        item = Product(**values)
        if item.publish_status == PublishStatus.published and item.published_at is None:
            item.published_at = datetime.now(UTC)
        item.images = [ProductImage(**image.model_dump()) for image in data.images]
        self.db.add(item)
        try:
            self.db.flush()
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
            raise _conflict(exc) from exc
        return self.products.get(item.id) or item

    def update_product(self, item: Product, data: ProductUpdate, admin_id: uuid.UUID) -> Product:
        changes = data.model_dump(exclude_unset=True, exclude={"images"})
        for key, value in changes.items():
            setattr(item, key, value)
        if (
            "publish_status" in changes
            and item.publish_status == PublishStatus.published
            and item.published_at is None
        ):
            item.published_at = datetime.now(UTC)
        if data.images is not None:
            existing = {image.storage_key: image for image in item.images}
            reconciled: list[ProductImage] = []
            for image_data in data.images:
                image = existing.pop(image_data.storage_key, None)
                if image is None:
                    image = ProductImage(**image_data.model_dump())
                else:
                    for key, value in image_data.model_dump().items():
                        setattr(image, key, value)
                reconciled.append(image)
            item.images[:] = reconciled
        self.db.add(
            AuditLog(
                admin_user_id=admin_id,
                action="update",
                entity_type="product",
                entity_id=item.id,
                changes={key: str(value) for key, value in changes.items()},
            )
        )
        try:
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise _conflict(exc) from exc
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
