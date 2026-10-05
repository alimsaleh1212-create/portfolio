"""Media items: the prepared Portrait, Video CV and CV PDF.

Revision ID: 0004
Revises: 0003
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create `media_items`, one row per role."""
    op.create_table(
        "media_items",
        sa.Column("role", sa.String(16), primary_key=True),
        sa.Column("source_sha256", sa.String(64), nullable=False),
        sa.Column("settings_hash", sa.String(64), nullable=False),
        sa.Column("alt", sa.Text(), nullable=True),
        sa.Column("download_name", sa.Text(), nullable=True),
        sa.Column("duration_seconds", sa.Float(), nullable=True),
        sa.Column("variants", postgresql.JSONB(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Drop `media_items`."""
    op.drop_table("media_items")
