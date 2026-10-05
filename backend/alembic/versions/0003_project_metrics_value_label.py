"""Project metrics become a value and a label.

Revision ID: 0003
Revises: 0002
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Replace the text[] column with a JSONB list of `{value, label}` objects.

    The old entries were sentence fragments that cannot be split reliably, so
    the column starts empty. Content is reloaded from `content/` by the seed,
    which runs at every startup.
    """
    op.drop_column("projects", "metrics")
    op.add_column(
        "projects",
        sa.Column(
            "metrics",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.alter_column("projects", "metrics", server_default=None)


def downgrade() -> None:
    """Restore the text[] column, empty; the seed refills it."""
    op.drop_column("projects", "metrics")
    op.add_column(
        "projects",
        sa.Column(
            "metrics",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
    )
    op.alter_column("projects", "metrics", server_default=None)
