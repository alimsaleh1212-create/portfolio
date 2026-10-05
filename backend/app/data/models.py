"""ORM tables for the text content.

The profile is one JSONB document in a one-row table: it is read whole, never
queried by field, and its lists (skills, experience, education) have no keys
worth a table of their own. Stages and Projects are real tables, each with a
unique key and an explicit position for ordering.
"""

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Integer,
    String,
    Text,
    UniqueConstraint,
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
    metrics: Mapped[list[str]] = mapped_column(ARRAY(Text))
