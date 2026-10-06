"""HTTP caching for the cached read endpoints: `ETag`, `Cache-Control` and 304."""

import hashlib
import re

from fastapi import Request, Response

# Browsers may keep a copy but must ask before reusing it: content changes at
# every seed, so a stored copy is never trusted blindly.
CACHEABLE_CONTROL = "no-cache"
# Everything else under /api/ (Visits, contact, health, errors) is never stored.
NO_STORE_CONTROL = "no-store"

# One entity tag in an `If-None-Match` list: optional weak marker, quoted opaque
# tag. The tag may contain commas, so the list is scanned, not split on commas.
_ENTITY_TAG = re.compile(r'(W/)?"([^"]*)"')


def etag_for(body: bytes) -> str:
    """Return the strong entity tag of a response body.

    The tag is a SHA-256 of the exact bytes sent, so it changes exactly when the
    body does.
    """
    return f'"{hashlib.sha256(body).hexdigest()[:32]}"'


def none_match(values: list[str], etag: str) -> bool:
    """Return True if any `If-None-Match` value matches `etag`.

    Uses the weak comparison RFC 9110 requires for this header: a `W/` prefix is
    ignored on both sides, and `*` matches any current representation.

    Args:
        values: The raw header lines; each may hold a comma-separated list.
        etag: The current entity tag, quoted.
    """
    current = etag.removeprefix("W/")
    for value in values:
        if value.strip() == "*":
            return True
        for match in _ENTITY_TAG.finditer(value):
            if f'"{match.group(2)}"' == current:
                return True
    return False


def conditional_json(request: Request, body: bytes) -> Response:
    """Answer 200 with `body`, or 304 with no body if the client has it already."""
    etag = etag_for(body)
    headers = {"ETag": etag, "Cache-Control": CACHEABLE_CONTROL}
    if none_match(request.headers.getlist("if-none-match"), etag):
        return Response(status_code=304, headers=headers)
    return Response(body, media_type="application/json", headers=headers)
