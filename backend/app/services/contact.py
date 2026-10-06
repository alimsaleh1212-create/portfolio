"""Contact service: validate, filter spam, rate limit, store, deliver.

A message is never linked to a Visit (ADR 0002). Nothing here logs the name,
address or text.
"""

import re
import uuid
from typing import Annotated

import structlog
from email_validator import EmailNotValidError, validate_email
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.data.contact_repo import ContactRepository, NewContactMessage
from app.data.rate_limit import WindowCounter
from app.services.clients import REDIS_FAILURES, ClientHasher, ClientInfo
from app.services.mailer import MailDelivery

logger = structlog.get_logger(__name__)

RATE_LIMIT_WINDOW_SECONDS = 3600
NAME_MAX = 100
EMAIL_MAX = 254
MESSAGE_MIN = 10
MESSAGE_MAX = 4000
HONEYPOT_FIELD = "website"

_ANY_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f\u2028\u2029]")
# Line breaks and tabs are fine in a message; every other control is not.
_BAD_IN_MESSAGE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u2028\u2029]")


class NewMessage(BaseModel):
    """The body of `POST /contact`.

    Messages are written for the Visitor: the API returns them beside the field.
    Fields are plain strings so the checks here are the only ones that run.
    """

    model_config = ConfigDict(extra="forbid")

    name: str
    email: str
    message: str
    # Hidden from people; a bot that fills every field fills this too.
    website: Annotated[str, Field(max_length=2000)] | None = None

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Enter your name.")
        if len(value) > NAME_MAX:
            raise ValueError(f"Use at most {NAME_MAX} characters for your name.")
        if _ANY_CONTROL.search(value):
            raise ValueError("Your name cannot contain line breaks or control codes.")
        return value

    @field_validator("email")
    @classmethod
    def _check_email(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Enter your email address.")
        if len(value) > EMAIL_MAX or _ANY_CONTROL.search(value):
            raise ValueError("Enter a valid email address, like name@example.com.")
        try:
            checked = validate_email(
                value, check_deliverability=False, allow_smtputf8=False
            )
        except EmailNotValidError:
            raise ValueError(
                "Enter a valid email address, like name@example.com."
            ) from None
        return checked.normalized

    @field_validator("message")
    @classmethod
    def _check_message(cls, value: str) -> str:
        value = value.replace("\r\n", "\n").replace("\r", "\n").strip()
        if len(value) < MESSAGE_MIN:
            raise ValueError(f"Write at least {MESSAGE_MIN} characters.")
        if len(value) > MESSAGE_MAX:
            raise ValueError(f"Keep your message to {MESSAGE_MAX} characters or fewer.")
        if _BAD_IN_MESSAGE.search(value):
            raise ValueError("Your message contains characters that cannot be sent.")
        return value


class RateLimitedError(Exception):
    """The client has sent too many messages in the window."""


class ContactService:
    """Accepts contact messages."""

    def __init__(
        self,
        repository: ContactRepository,
        hasher: ClientHasher,
        counter: WindowCounter,
        limit_per_window: int,
        mail: MailDelivery,
    ) -> None:
        """Wire the collaborators."""
        self._repository = repository
        self._hasher = hasher
        self._counter = counter
        self._limit = limit_per_window
        self._mail = mail

    async def _enforce_limit(self, client: ClientInfo) -> None:
        """Count a message against the client's limit.

        Raises:
            RateLimitedError: Over the limit. Redis being unavailable never
                raises it: messages are let through.
        """
        key = await self._hasher.rate_limit_key(client)
        if key is None:
            return
        try:
            count = await self._counter.hit(f"contact:{key}", RATE_LIMIT_WINDOW_SECONDS)
        except REDIS_FAILURES as exc:
            logger.warning("rate_limit_unavailable", reason=type(exc).__name__)
            return
        if count > self._limit:
            raise RateLimitedError

    async def submit(self, body: NewMessage, client: ClientInfo) -> uuid.UUID | None:
        """Handle one message.

        Returns:
            The stored message's ID, or None when the honeypot was filled and
            nothing was stored.

        Raises:
            RateLimitedError: The client is over its limit.
            ContactStorageError: The message could not be stored.
        """
        if body.website:
            logger.info("contact_honeypot_filled")
            return None
        await self._enforce_limit(client)
        message_id = await self._repository.create(
            NewContactMessage(body.name, body.email, body.message)
        )
        logger.info("contact_message_received", message_id=str(message_id))
        return message_id

    async def deliver(self, message_id: uuid.UUID, body: NewMessage) -> None:
        """Email a stored message to Ali, if mail is set up. Never raises."""
        await self._mail.deliver(message_id, body.name, body.email, body.message)
