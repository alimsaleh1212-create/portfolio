"""Reduce a referrer to the referring site's host, or to nothing."""

import ipaddress
import re
from urllib.parse import urlsplit

_HOST_LABEL = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")
MAX_HOST_LENGTH = 253


def _hostname(url: str) -> str | None:
    try:
        host = urlsplit(url).hostname
    except ValueError:
        return None
    if not host:
        return None
    host = host.lower().rstrip(".")
    if not host or len(host) > MAX_HOST_LENGTH:
        return None
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        # An address is not a site, and could be a Visitor's own network.
        return None
    labels = host.split(".")
    if not all(_HOST_LABEL.fullmatch(label) for label in labels):
        return None
    return host


def _scheme(url: str) -> str:
    """Return the lower-case scheme of a URL, or an empty string."""
    try:
        return urlsplit(url).scheme.lower()
    except ValueError:
        return ""


def referring_host(referrer: str | None, own_host: str | None) -> str | None:
    """Return the referrer's host, or None.

    The path, query, fragment, port and credentials are dropped. None comes back
    when the referrer is absent, is not an http(s) URL, has no usable host (an IP
    address counts as unusable) or is the site itself.

    Args:
        referrer: The page's `document.referrer`, as sent by the client.
        own_host: The `Host` header the request arrived with.
    """
    if not referrer or _scheme(referrer) not in {"http", "https"}:
        return None
    host = _hostname(referrer)
    if host is None:
        return None
    own = _hostname(f"//{own_host}") if own_host else None
    if own is not None and host == own:
        return None
    return host
