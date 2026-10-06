"""A mail server running inside the test process, for delivery tests."""

import asyncio
import logging
import socket
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from email import message_from_bytes
from email.message import Message
from typing import Any

from aiosmtpd.controller import Controller
from aiosmtpd.smtp import SMTP, AuthResult, Envelope, LoginPassword, Session


@dataclass
class Inbox:
    """What the test server received."""

    messages: list[Message] = field(default_factory=list)
    envelopes: list[tuple[str, list[str]]] = field(default_factory=list)
    logins: list[tuple[str, str]] = field(default_factory=list)


class _Handler:
    def __init__(self, inbox: Inbox, reply: str, delay: float) -> None:
        self._inbox = inbox
        self._reply = reply
        self._delay = delay

    async def handle_DATA(  # noqa: N802
        self, server: SMTP, session: Session, envelope: Envelope
    ) -> str:
        await asyncio.sleep(self._delay)
        if self._reply.startswith("2"):
            self._inbox.messages.append(message_from_bytes(_as_bytes(envelope.content)))
            self._inbox.envelopes.append(
                (str(envelope.mail_from or ""), [str(r) for r in envelope.rcpt_tos])
            )
        return self._reply


def _as_bytes(content: bytes | str | None) -> bytes:
    if content is None:
        return b""
    return content.encode() if isinstance(content, str) else content


def free_port() -> int:
    """Return a port nothing is listening on."""
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@contextmanager
def mail_server(
    reply: str = "250 OK", users: dict[str, str] | None = None, delay: float = 0.0
) -> Iterator[tuple[int, Inbox]]:
    """Run an SMTP server on a free port; yield the port and what it receives.

    Args:
        reply: The server's answer to the message data ("554 no" refuses it).
        delay: Seconds the server takes to answer the message data.
        users: When given, login is offered and only these users are accepted.
    """
    inbox = Inbox()
    port = free_port()

    def authenticate(
        server: SMTP, session: Session, envelope: Envelope, mechanism: str, data: Any
    ) -> AuthResult:
        login = data if isinstance(data, LoginPassword) else None
        if login is None or users is None:
            return AuthResult(success=False)
        name, password = login.login.decode(), login.password.decode()
        ok = users.get(name) == password
        if ok:
            inbox.logins.append((name, password))
        return AuthResult(success=ok)

    # The test server's own log lines name every sender and recipient; keep them
    # out of the captured output so it holds only what the application logged.
    logging.getLogger("mail.log").propagate = False
    controller = Controller(
        _Handler(inbox, reply, delay),
        hostname="127.0.0.1",
        port=port,
        authenticator=authenticate if users is not None else None,
        auth_required=users is not None,
        auth_require_tls=False,
    )
    controller.start()
    try:
        yield port, inbox
    finally:
        controller.stop()
