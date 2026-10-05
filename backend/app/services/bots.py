"""Recognise crawlers and automation tools by their user agent."""

import re

# Substrings of known crawlers, link-preview fetchers, HTTP libraries and
# automation tools. Matched case-insensitively. "headless" catches the default
# user agent of headless Chrome ("HeadlessChrome").
_BOT_PATTERN = re.compile(
    "|".join(
        [
            "bot",
            "crawl",
            "spider",
            "slurp",
            "scrap",
            "headless",
            "phantomjs",
            "selenium",
            "webdriver",
            "puppeteer",
            "playwright",
            "lighthouse",
            "pagespeed",
            "preview",
            "facebookexternalhit",
            "curl",
            "wget",
            "httpx",
            "python-requests",
            "python-urllib",
            "aiohttp",
            "go-http-client",
            "java/",
            "libwww",
            "node-fetch",
            "axios",
            "postman",
            "okhttp",
            "monitor",
            "uptime",
        ]
    ),
    re.IGNORECASE,
)


def is_bot(user_agent: str | None) -> bool:
    """Return whether a user agent belongs to a known bot.

    A request with no user agent at all is treated as a bot: browsers always
    send one.
    """
    if not user_agent or not user_agent.strip():
        return True
    return _BOT_PATTERN.search(user_agent) is not None
