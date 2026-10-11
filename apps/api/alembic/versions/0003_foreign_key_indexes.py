"""add foreign key indexes

Revision ID: 0003
Revises: 0002
"""

from pathlib import Path

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    sql_path = (
        Path(__file__).resolve().parents[4]
        / "supabase"
        / "migrations"
        / "202610100003_foreign_key_indexes.sql"
    )
    op.execute(sql_path.read_text(encoding="utf-8"))


def downgrade() -> None:
    raise RuntimeError(
        "Destructive downgrade is intentionally disabled. Restore from a reviewed backup instead."
    )
