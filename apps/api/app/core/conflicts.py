from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError

_CONSTRAINT_MESSAGES = {
    "categories_slug_key": "Slug already exists",
    "products_slug_key": "Slug already exists",
    "products_sku_key": "SKU already exists",
    "posts_slug_key": "Slug already exists",
    "product_images_storage_key_key": "Image storage key already exists",
    "post_images_storage_key_key": "Image storage key already exists",
    "product_images_product_id_sort_order_key": "Image order conflicts with another image",
    "post_images_post_id_sort_order_key": "Image order conflicts with another image",
    "uq_product_primary_image": "Only one primary image is allowed",
}

_SQLITE_MARKER_MESSAGES = {
    "UNIQUE constraint failed: categories.slug": "Slug already exists",
    "UNIQUE constraint failed: products.slug": "Slug already exists",
    "UNIQUE constraint failed: products.sku": "SKU already exists",
    "UNIQUE constraint failed: posts.slug": "Slug already exists",
    "UNIQUE constraint failed: product_images.storage_key": "Image storage key already exists",
    "UNIQUE constraint failed: post_images.storage_key": "Image storage key already exists",
    (
        "UNIQUE constraint failed: product_images.product_id, "
        "product_images.sort_order"
    ): "Image order conflicts with another image",
    (
        "UNIQUE constraint failed: post_images.post_id, post_images.sort_order"
    ): "Image order conflicts with another image",
    "UNIQUE constraint failed: product_images.product_id": "Only one primary image is allowed",
}


def integrity_conflict(exc: IntegrityError) -> HTTPException:
    """Convert known database constraints to fixed, non-sensitive API messages."""
    diagnostic = getattr(exc.orig, "diag", None)
    constraint_name = getattr(diagnostic, "constraint_name", None)
    detail = _CONSTRAINT_MESSAGES.get(str(constraint_name))
    if detail is None:
        database_message = str(exc.orig)
        detail = next(
            (
                message
                for marker, message in _SQLITE_MARKER_MESSAGES.items()
                if marker == database_message
            ),
            "Data conflicts with an existing record",
        )
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)
