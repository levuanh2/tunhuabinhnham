"""initial schema

Revision ID: 0001
Revises:
"""

from pathlib import Path

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    sql_path = (
        Path(__file__).resolve().parents[4] / "supabase" / "migrations" / "202610100001_initial.sql"
    )
    op.execute(sql_path.read_text(encoding="utf-8"))


def downgrade() -> None:
    raise RuntimeError(
        "Destructive downgrade is intentionally disabled. Restore from a reviewed backup instead."
    )
