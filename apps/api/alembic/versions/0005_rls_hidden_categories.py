"""policies: products and images of hidden categories are not public

Revision ID: 0005
Revises: 0004
"""

from pathlib import Path

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    sql_path = (
        Path(__file__).resolve().parents[4]
        / "supabase"
        / "migrations"
        / "20261014090000_rls_hidden_categories.sql"
    )
    op.execute(sql_path.read_text(encoding="utf-8"))


def downgrade() -> None:
    raise RuntimeError("Apply the reviewed rollback migration instead of downgrading.")
