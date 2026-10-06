"""Visits, their events, and the views Grafana reads.

Revision ID: 0005
Revises: 0004
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Progress is the highest Stage a Visit reached, by Climb order (stages.position).
# Visits that reached no Stage appear with NULLs. Derived, never stored.
VISIT_PROGRESS_VIEW = """
CREATE VIEW visit_progress AS
SELECT
    v.id AS visit_id,
    v.started_at,
    v.referrer_host,
    v.device_class,
    v.tier,
    top.key AS progress_stage_key,
    top.position AS progress_stage_position
FROM visits v
LEFT JOIN LATERAL (
    SELECT s.key, s.position
    FROM visit_events e
    JOIN stages s ON s.key = e.stage_key
    WHERE e.visit_id = v.id AND e.type = 'stage_reached'
    ORDER BY s.position DESC
    LIMIT 1
) top ON true
"""

# A funnel: for each Stage, the number of Visits whose Progress is that Stage or
# a higher one. A Visit that got to the Ridge got past every Stage below it, even
# when their events are missing (a fast scroll, a jump), so the counts never
# increase going up the mountain. Every Stage appears, in Climb order, with zero
# when no Visit got that far.
VISITS_PER_STAGE_VIEW = """
CREATE VIEW visits_per_stage AS
SELECT
    s.position AS stage_position,
    s.key AS stage_key,
    s.name AS stage_name,
    count(p.visit_id) AS visits
FROM stages s
LEFT JOIN visit_progress p ON p.progress_stage_position >= s.position
GROUP BY s.position, s.key, s.name
ORDER BY s.position
"""


def upgrade() -> None:
    """Create `visits`, `visit_events` and the two views."""
    op.create_table(
        "visits",
        sa.Column(
            "id",
            sa.Uuid(),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("referrer_host", sa.Text(), nullable=True),
        sa.Column("device_class", sa.String(8), nullable=False),
        sa.Column("tier", sa.String(8), nullable=True),
        sa.Column("visitor_hash", sa.String(32), nullable=True),
        sa.CheckConstraint(
            "device_class IN ('phone', 'tablet', 'desktop')",
            name="ck_visits_device_class",
        ),
        sa.CheckConstraint(
            "tier IS NULL OR tier IN ('full', 'light', 'still')",
            name="ck_visits_tier",
        ),
    )
    op.create_index("ix_visits_started_at", "visits", ["started_at"])
    op.create_table(
        "visit_events",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column(
            "visit_id",
            sa.Uuid(),
            sa.ForeignKey("visits.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("type", sa.String(24), nullable=False),
        sa.Column("stage_key", sa.String(32), nullable=True),
        sa.Column("project_slug", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(type = 'stage_reached' AND stage_key IS NOT NULL "
            "AND project_slug IS NULL) "
            "OR (type = 'project_opened' AND project_slug IS NOT NULL "
            "AND stage_key IS NULL) "
            "OR (type IN ('cv_downloaded', 'contact_message_sent') "
            "AND stage_key IS NULL AND project_slug IS NULL)",
            name="ck_visit_events_shape",
        ),
    )
    op.create_index("ix_visit_events_visit_id", "visit_events", ["visit_id"])
    # A Stage is reached once per Visit; the insert relies on this to de-duplicate.
    op.create_index(
        "uq_visit_events_stage_once",
        "visit_events",
        ["visit_id", "stage_key"],
        unique=True,
        postgresql_where=sa.text("type = 'stage_reached'"),
    )
    op.execute(VISIT_PROGRESS_VIEW)
    op.execute(VISITS_PER_STAGE_VIEW)


def downgrade() -> None:
    """Drop the views and both tables."""
    op.execute("DROP VIEW visits_per_stage")
    op.execute("DROP VIEW visit_progress")
    op.drop_table("visit_events")
    op.drop_table("visits")
