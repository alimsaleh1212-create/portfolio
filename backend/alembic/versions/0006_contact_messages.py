"""Contact messages.

There is no Visit ID on purpose: see `ContactMessageRow`.

Revision ID: 0006
Revises: 0005
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create `contact_messages`."""
    op.create_table(
        "contact_messages",
        sa.Column(
            "id",
            sa.Uuid(),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
    )
    op.create_index(
        "ix_contact_messages_created_at", "contact_messages", ["created_at"]
    )


def downgrade() -> None:
    """Drop `contact_messages`."""
    op.drop_table("contact_messages")
