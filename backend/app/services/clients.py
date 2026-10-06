"""The client's address and user agent, and what is derived from them.

The IP address exists only in memory for the length of one request (ADR 0002).
`ClientInfo` hides its fields from `repr`, so a stray log line or exception
message cannot carry them. Nothing here stores or logs the address.
"""

import hashlib
import hmac
import ipaddress
from dataclasses import dataclass, field

import structlog
from redis.exceptions import RedisError

from app.data.visitor_salt import DailySaltStore

logger = structlog.get_logger(__name__)

# What can go wrong when Redis is unreachable or slow.
REDIS_FAILURES = (RedisError, OSError, TimeoutError, LookupError)

HASH_LENGTH = 32
"""Hex characters kept from the digest (128 bits)."""


@dataclass(frozen=True)
class ClientInfo:
    """The client behind a request, as far as the hash needs it."""

    address: str = field(repr=False)
    user_agent: str = field(repr=False)


def parse_forwarded_address(forwarded_for: str | None) -> str | None:
    """Return the client address from an `X-Forwarded-For` value.

    Caddy overwrites the header with the address it saw, so there is one entry.
    If a proxy ever appended instead, the last entry is the one our own proxy
    added and the earlier ones are what the client claimed, so the last is taken.

    Args:
        forwarded_for: The raw header value, if any.

    Returns:
        The address in canonical form, or None when absent or not an address.
    """
    if not forwarded_for:
        return None
    last = forwarded_for.rsplit(",", 1)[-1].strip()
    try:
        return str(ipaddress.ip_address(last))
    except ValueError:
        return None


def _digest(salt: bytes, purpose: str, *parts: str) -> str:
    message = "\0".join((purpose, *parts)).encode()
    return hmac.new(salt, message, hashlib.sha256).hexdigest()[:HASH_LENGTH]


class ClientHasher:
    """Keyed hashes of a client, using the daily salt."""

    def __init__(self, salts: DailySaltStore) -> None:
        """Store the salt source."""
        self._salts = salts

    async def visitor_hash(self, client: ClientInfo) -> str | None:
        """Return the daily Visitor hash, or None when Redis is unavailable."""
        salt = await self._salt("visitor_hash_unavailable")
        if salt is None:
            return None
        return _digest(salt, "visitor", client.address, client.user_agent)

    async def rate_limit_key(self, client: ClientInfo) -> str | None:
        """Return an opaque per-client key for rate limits, or None.

        It is a hash of the address alone (a different purpose from the Visitor
        hash), so Redis never holds the address.
        """
        salt = await self._salt("rate_limit_unavailable")
        if salt is None:
            return None
        return _digest(salt, "rate-limit", client.address)

    async def _salt(self, event: str) -> bytes | None:
        try:
            return await self._salts.current()
        except REDIS_FAILURES as exc:
            # The class name only: never anything the failure carries.
            logger.warning(event, reason=type(exc).__name__)
            return None
