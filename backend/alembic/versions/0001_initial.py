"""Initial migration: baseline with no tables yet.

Later tickets add content, Visit and contact-message tables on top of this.
Applying it creates Alembic's `alembic_version` table, which proves the
migration path works end to end.

Revision ID: 0001
Revises:
"""

from collections.abc import Sequence

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create nothing; establish the baseline revision."""


def downgrade() -> None:
    """Nothing to undo."""
