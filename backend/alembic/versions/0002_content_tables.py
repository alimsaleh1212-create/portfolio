"""Content tables: profile, stages and projects.

Revision ID: 0002
Revises: 0001
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the three content tables."""
    op.create_table(
        "profile",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("data", postgresql.JSONB(), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_profile_single_row"),
    )
    op.create_table(
        "stages",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("key", sa.String(32), nullable=False, unique=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("period", sa.Text(), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("challenge", sa.Text(), nullable=False),
        sa.Column("challenge_is_placeholder", sa.Boolean(), nullable=False),
        sa.UniqueConstraint(
            "position", name="uq_stages_position", deferrable=True, initially="DEFERRED"
        ),
    )
    op.create_table(
        "projects",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("slug", sa.String(64), nullable=False, unique=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("tagline", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("stack", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("metrics", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.UniqueConstraint(
            "position",
            name="uq_projects_position",
            deferrable=True,
            initially="DEFERRED",
        ),
    )


def downgrade() -> None:
    """Drop the three content tables."""
    op.drop_table("projects")
    op.drop_table("stages")
    op.drop_table("profile")
