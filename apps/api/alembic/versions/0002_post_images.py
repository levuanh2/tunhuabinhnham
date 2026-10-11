"""add post images

Revision ID: 0002
Revises: 0001
"""

from pathlib import Path

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    sql_path = (
        Path(__file__).resolve().parents[4]
        / "supabase"
        / "migrations"
        / "202610100002_post_images.sql"
    )
    op.execute(sql_path.read_text(encoding="utf-8"))


def downgrade() -> None:
    raise RuntimeError(
        "Destructive downgrade is intentionally disabled. Restore from a reviewed backup instead."
    )
