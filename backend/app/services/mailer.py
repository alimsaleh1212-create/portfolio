"""Email delivery of contact messages.

A message is delivered by one attempt over SMTP. It is not retried: the message
is already stored, and a retry queue would be a second place holding the
Visitor's details. Nothing in this module logs the name, address or text, and
failures are reported by class name only.
"""

import re
import uuid
from dataclasses import dataclass, field
from email.message import EmailMessage
from email.policy import SMTP as SMTP_POLICY
from typing import Literal

import aiosmtplib
import structlog

logger = structlog.get_logger(__name__)

Security = Literal["starttls", "tls", "none"]

_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f\u2028\u2029]")
MAX_SUBJECT_NAME = 100


@dataclass(frozen=True)
class MailSettings:
    """Where and how to deliver. Credentials are hidden from `repr`."""

    host: str
    port: int
    security: Security
    sender: str
    recipient: str
    timeout_seconds: float
    username: str | None = field(default=None, repr=False)
    password: str | None = field(default=None, repr=False)


def header_text(value: str) -> str:
    """Make a value safe for a header: no line breaks or control characters.

    Validation already refuses these; this is the second guard, so a caller that
    skipped validation still cannot inject a header.
    """
    return " ".join(_CONTROL.sub(" ", value).split())


def build_email(
    settings: MailSettings, message_id: uuid.UUID, name: str, email: str, text: str
) -> EmailMessage:
    """Build the email to Ali, with the Visitor's address as Reply-To.

    Raises:
        ValueError: The address is not a single plain address.
    """
    safe_name = header_text(name)[:MAX_SUBJECT_NAME]
    safe_email = header_text(email)
    if not safe_email or " " in safe_email or "," in safe_email or "<" in safe_email:
        raise ValueError("not a single address")
    mail = EmailMessage(policy=SMTP_POLICY)
    mail["From"] = settings.sender
    mail["To"] = settings.recipient
    mail["Reply-To"] = safe_email
    mail["Subject"] = f"Portfolio message from {safe_name}"
    mail["X-Portfolio-Message-ID"] = str(message_id)
    mail.set_content(f"Name: {safe_name}\nEmail: {safe_email}\n\n{text}\n")
    return mail


class MailDelivery:
    """Sends contact messages to Ali, when mail settings are present."""

    def __init__(self, settings: MailSettings | None) -> None:
        """Store the settings, or None for no delivery."""
        self._settings = settings

    @property
    def enabled(self) -> bool:
        """Whether mail settings are present."""
        return self._settings is not None

    async def deliver(
        self, message_id: uuid.UUID, name: str, email: str, text: str
    ) -> bool:
        """Try once to email a stored message. Never raises.

        Returns:
            True when the server accepted it, False when it failed or delivery is
            off. The outcome is logged by message ID and error class only.
        """
        settings = self._settings
        if settings is None:
            logger.info("contact_delivery", message_id=str(message_id), attempted=False)
            return False
        logger.info("contact_delivery", message_id=str(message_id), attempted=True)
        try:
            mail = build_email(settings, message_id, name, email, text)
            await aiosmtplib.send(
                mail,
                sender=settings.sender,
                recipients=[settings.recipient],
                hostname=settings.host,
                port=settings.port,
                username=settings.username,
                password=settings.password,
                use_tls=settings.security == "tls",
                start_tls=settings.security == "starttls",
                timeout=settings.timeout_seconds,
            )
        except (aiosmtplib.SMTPException, OSError, TimeoutError, ValueError) as exc:
            # The class name only: never anything the failure carries.
            logger.warning(
                "contact_delivery_failed",
                message_id=str(message_id),
                delivered=False,
                reason=type(exc).__name__,
            )
            return False
        logger.info("contact_delivery_done", message_id=str(message_id), delivered=True)
        return True
