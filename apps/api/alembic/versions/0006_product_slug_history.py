"""product slug history: old product URLs redirect to the current one

Revision ID: 0006
Revises: 0005
"""

from pathlib import Path

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    sql_path = (
        Path(__file__).resolve().parents[4]
        / "supabase"
        / "migrations"
        / "20261015090000_product_slug_history.sql"
    )
    op.execute(sql_path.read_text(encoding="utf-8"))


def downgrade() -> None:
    raise RuntimeError("Apply the reviewed rollback migration instead of downgrading.")
