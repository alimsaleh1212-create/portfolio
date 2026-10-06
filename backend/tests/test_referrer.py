"""Reducing a referrer to a host."""

import pytest

from app.services.referrer import referring_host

OWN = "portfolio.example"


@pytest.mark.parametrize(
    ("referrer", "expected"),
    [
        ("https://www.linkedin.com/feed/?q=1#x", "www.linkedin.com"),
        ("http://News.Example.COM/a/b", "news.example.com"),
        ("https://example.com:8443/a", "example.com"),
        ("https://user:secret@example.org/a", "example.org"),
        ("https://example.com./a", "example.com"),
        ("https://portfolio.example/summary", None),
        ("https://PORTFOLIO.example:8080/", None),
        (None, None),
        ("", None),
        ("not a url", None),
        ("javascript:alert(1)", None),
        ("ftp://example.com/", None),
        ("https://", None),
        ("https://10.0.0.5/page", None),
        ("https://[2001:db8::1]/page", None),
        ("https://exa mple.com/", None),
        ("https://-bad-.example/", None),
        ("https://[bad/", None),
        ("https://" + "a" * 300 + ".com/", None),
    ],
)
def test_the_referrer_becomes_a_host_or_nothing(
    referrer: str | None, expected: str | None
) -> None:
    assert referring_host(referrer, OWN) == expected


def test_without_a_known_own_host_nothing_is_dropped_as_own() -> None:
    assert referring_host("https://portfolio.example/", None) == "portfolio.example"
