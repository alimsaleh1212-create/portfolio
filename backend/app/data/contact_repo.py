"""Data access for contact messages."""

import uuid
from dataclasses import dataclass, field

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.data.models import ContactMessageRow


class ContactStorageError(Exception):
    """A message could not be stored.

    Raised without the original error attached: a database error's text carries
    the statement's parameters, which here are the Visitor's name, address and
    message, and those must never reach a log.
    """


@dataclass(frozen=True)
class NewContactMessage:
    """What is stored for one message. Hidden from `repr` so it cannot be logged."""

    name: str = field(repr=False)
    email: str = field(repr=False)
    message: str = field(repr=False)


class ContactRepository:
    """Writes the contact_messages table."""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        """Store the session factory; each call opens its own session."""
        self._session_factory = session_factory

    async def create(self, new: NewContactMessage) -> uuid.UUID:
        """Insert a message and return its ID.

        Raises:
            ContactStorageError: The database refused or could not be reached.
        """
        try:
            async with self._session_factory() as session, session.begin():
                row = ContactMessageRow(
                    name=new.name, email=new.email, message=new.message
                )
                session.add(row)
                await session.flush()
                return row.id
        except (SQLAlchemyError, OSError):
            raise ContactStorageError from None
