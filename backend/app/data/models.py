"""ORM tables for the text content.

The profile is one JSONB document in a one-row table: it is read whole, never
queried by field, and its lists (skills, experience, education) have no keys
worth a table of their own. Stages and Projects are real tables, each with a
unique key and an explicit position for ordering.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.data.db import Base


class ProfileRow(Base):
    """The profile document. Only the row with id 1 may exist."""

    __tablename__ = "profile"
    __table_args__ = (CheckConstraint("id = 1", name="ck_profile_single_row"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    data: Mapped[dict] = mapped_column(JSONB)


class StageRow(Base):
    """One Stage of the Climb."""

    __tablename__ = "stages"
    __table_args__ = (
        # Deferred so a reordering can swap positions inside one transaction.
        UniqueConstraint(
            "position", name="uq_stages_position", deferrable=True, initially="DEFERRED"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(32), unique=True)
    position: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(Text)
    period: Mapped[str | None] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text)
    challenge: Mapped[str] = mapped_column(Text)
    challenge_is_placeholder: Mapped[bool] = mapped_column(Boolean)


class ProjectRow(Base):
    """One Project shown on the Ridge."""

    __tablename__ = "projects"
    __table_args__ = (
        UniqueConstraint(
            "position",
            name="uq_projects_position",
            deferrable=True,
            initially="DEFERRED",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True)
    position: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(Text)
    tagline: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text)
    stack: Mapped[list[str]] = mapped_column(ARRAY(Text))
    metrics: Mapped[list[dict[str, str]]] = mapped_column(JSONB)


class MediaItemRow(Base):
    """One prepared media item, keyed by its role.

    The roles are portrait, video_cv, cv_pdf, hiker and stills.

    `variants` lists the stored objects as JSON (kind, format, key, size and
    dimensions). `source_sha256` and `settings_hash` say what the objects were
    made from, so the seed can tell when nothing needs doing.
    """

    __tablename__ = "media_items"

    role: Mapped[str] = mapped_column(String(16), primary_key=True)
    source_sha256: Mapped[str] = mapped_column(String(64))
    settings_hash: Mapped[str] = mapped_column(String(64))
    alt: Mapped[str | None] = mapped_column(Text)
    download_name: Mapped[str | None] = mapped_column(Text)
    duration_seconds: Mapped[float | None] = mapped_column(Float)
    variants: Mapped[list[dict]] = mapped_column(JSONB)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class VisitRow(Base):
    """One Visit: one page load of the site.

    There is no Progress column. Progress is derived from the Visit's Stage
    reached events by the `visit_progress` view, so it cannot disagree with them.
    `visitor_hash` is the daily Visitor hash, or NULL when Redis was down.
    """

    __tablename__ = "visits"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, server_default=func.gen_random_uuid()
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    referrer_host: Mapped[str | None] = mapped_column(Text)
    device_class: Mapped[str] = mapped_column(String(8))
    tier: Mapped[str | None] = mapped_column(String(8))
    visitor_hash: Mapped[str | None] = mapped_column(String(32))


class VisitEventRow(Base):
    """One event within a Visit. Deleting a Visit deletes its events."""

    __tablename__ = "visit_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    visit_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("visits.id", ondelete="CASCADE")
    )
    type: Mapped[str] = mapped_column(String(24))
    stage_key: Mapped[str | None] = mapped_column(String(32))
    project_slug: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ContactMessageRow(Base):
    """One contact message.

    Deliberately has no Visit ID: a name and an email address beside a Visit
    would identify that Visit, which ADR 0002 forbids. This table is the one
    place personal details are stored, because the Visitor typed them in.
    """

    __tablename__ = "contact_messages"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, server_default=func.gen_random_uuid()
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(254))
    message: Mapped[str] = mapped_column(Text)
