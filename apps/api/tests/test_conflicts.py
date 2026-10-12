from dataclasses import dataclass

from sqlalchemy.exc import IntegrityError

from app.core.conflicts import integrity_conflict


@dataclass
class _Diagnostic:
    constraint_name: str


class _DatabaseError(Exception):
    def __init__(self, message: str, constraint_name: str | None = None):
        super().__init__(message)
        self.diag = _Diagnostic(constraint_name) if constraint_name else None


def _integrity_error(message: str, constraint_name: str | None = None) -> IntegrityError:
    return IntegrityError(
        "select leaked_sql",
        {"password": "leaked-password"},
        _DatabaseError(message, constraint_name),
    )


def test_postgres_constraint_names_map_to_fixed_messages() -> None:
    assert (
        integrity_conflict(_integrity_error("private", "posts_slug_key")).detail
        == "Slug already exists"
    )
    assert (
        integrity_conflict(_integrity_error("private", "products_sku_key")).detail
        == "SKU already exists"
    )
    assert (
        integrity_conflict(
            _integrity_error("private", "post_images_storage_key_key")
        ).detail
        == "Image storage key already exists"
    )


def test_unknown_constraint_never_leaks_database_error() -> None:
    conflict = integrity_conflict(
        _integrity_error("SECRET_SENTINEL raw SQL", "unknown_private_constraint")
    )

    assert conflict.status_code == 409
    assert conflict.detail == "Data conflicts with an existing record"
    assert "SECRET_SENTINEL" not in str(conflict.detail)
    assert "unknown_private_constraint" not in str(conflict.detail)
