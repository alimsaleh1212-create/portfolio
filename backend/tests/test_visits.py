"""Visits and their events, against real Postgres and Redis."""

import uuid
from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from redis import Redis

from app.config import Settings
from app.main import create_app
from tests.db_helpers import fetch_all
from tests.visit_helpers import (
    CHROME_UA,
    CLIENT_IP,
    OTHER_IP,
    FakeClock,
    as_text,
    redis_dump,
    scratch_redis_url,
    seed_content_rows,
)

MAKE_CLIENT = Callable[..., TestClient]


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def redis(settings: Settings) -> Iterator[Redis]:
    connection = Redis.from_url(scratch_redis_url(settings.redis_url))
    connection.flushdb()
    yield connection
    connection.flushdb()
    connection.close()


@pytest.fixture
def database_url(test_database_url: str) -> str:
    seed_content_rows(test_database_url)
    return test_database_url


@pytest.fixture
def visit_client(
    settings: Settings, database_url: str, redis: Redis, clock: FakeClock
) -> Iterator[MAKE_CLIENT]:
    """Factory for clients on the test database, scratch Redis and fake clock."""
    clients: list[TestClient] = []

    def factory(**overrides: Any) -> TestClient:
        update: dict[str, Any] = {
            "database_url": database_url,
            "redis_url": scratch_redis_url(settings.redis_url),
            "health_check_timeout_seconds": 1.0,
            **overrides,
        }
        client = TestClient(create_app(settings.model_copy(update=update), clock))
        client.headers.update({"user-agent": CHROME_UA, "x-forwarded-for": CLIENT_IP})
        client.__enter__()
        clients.append(client)
        return client

    yield factory
    for client in clients:
        client.__exit__(None, None, None)


@pytest.fixture
def client(visit_client: MAKE_CLIENT) -> TestClient:
    return visit_client()


START = {"device": "desktop"}


def start(client: TestClient, **body: Any) -> uuid.UUID:
    response = client.post("/api/v1/visits", json={**START, **body})
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"])


def event(client: TestClient, visit_id: uuid.UUID, **body: Any):
    return client.post(f"/api/v1/visits/{visit_id}/events", json=body)


def rows(database_url: str, sql: str) -> list[dict[str, Any]]:
    return fetch_all(database_url, sql)


# Starting a Visit


def test_starting_a_visit_records_it_and_returns_its_id(
    client: TestClient, database_url: str
) -> None:
    response = client.post(
        "/api/v1/visits",
        json={"device": "phone", "tier": "light", "referrer": "https://news.example/a"},
    )

    assert response.status_code == 201
    [row] = rows(database_url, "SELECT * FROM visits")
    assert str(row["id"]) == response.json()["id"]
    assert row["device_class"] == "phone"
    assert row["tier"] == "light"
    assert row["referrer_host"] == "news.example"
    assert row["started_at"].tzinfo is not None
    assert row["visitor_hash"] and len(row["visitor_hash"]) == 32


def test_the_tier_is_optional(client: TestClient, database_url: str) -> None:
    start(client)

    assert rows(database_url, "SELECT tier FROM visits") == [{"tier": None}]


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"device": "watch"},
        {"device": "desktop", "tier": "ultra"},
        {"device": "desktop", "extra": 1},
        {"device": "desktop", "referrer": "x" * 3000},
    ],
)
def test_a_bad_start_body_is_rejected(
    client: TestClient, database_url: str, body: dict[str, Any]
) -> None:
    response = client.post("/api/v1/visits", json=body)

    assert response.status_code == 422
    assert rows(database_url, "SELECT * FROM visits") == []


def test_an_oversized_body_is_refused(client: TestClient) -> None:
    response = client.post("/api/v1/visits", json={**START, "referrer": "a" * 5000})

    assert response.status_code == 413


def test_a_chunked_oversized_body_is_refused(client: TestClient) -> None:
    def chunks() -> Iterator[bytes]:
        for _ in range(10):
            yield b" " * 500

    response = client.post(
        "/api/v1/visits", content=chunks(), headers={"content-type": "application/json"}
    )

    assert response.status_code == 413


def test_a_body_that_is_not_json_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/api/v1/visits",
        content="device=desktop",
        headers={"content-type": "text/plain"},
    )

    assert response.status_code == 422


# Events


def test_each_event_type_is_recorded(client: TestClient, database_url: str) -> None:
    visit = start(client)

    assert event(client, visit, type="stage_reached", stage="ridge").status_code == 204
    assert (
        event(client, visit, type="project_opened", project="alpha-agent").status_code
        == 204
    )
    assert event(client, visit, type="cv_downloaded").status_code == 204
    assert event(client, visit, type="contact_message_sent").status_code == 204

    got = rows(
        database_url,
        "SELECT type, stage_key, project_slug FROM visit_events ORDER BY id",
    )
    assert got == [
        {"type": "stage_reached", "stage_key": "ridge", "project_slug": None},
        {"type": "project_opened", "stage_key": None, "project_slug": "alpha-agent"},
        {"type": "cv_downloaded", "stage_key": None, "project_slug": None},
        {"type": "contact_message_sent", "stage_key": None, "project_slug": None},
    ]


def test_a_stage_reached_is_recorded_once_per_visit_and_stage(
    client: TestClient, database_url: str
) -> None:
    visit = start(client)

    first = event(client, visit, type="stage_reached", stage="trailhead")
    again = event(client, visit, type="stage_reached", stage="trailhead")
    other = event(client, visit, type="stage_reached", stage="ridge")

    assert (first.status_code, again.status_code, other.status_code) == (204, 204, 204)
    assert rows(database_url, "SELECT stage_key FROM visit_events ORDER BY id") == [
        {"stage_key": "trailhead"},
        {"stage_key": "ridge"},
    ]


def test_the_same_stage_in_another_visit_is_recorded(
    client: TestClient, database_url: str
) -> None:
    for _ in range(2):
        event(client, start(client), type="stage_reached", stage="ridge")

    assert len(rows(database_url, "SELECT * FROM visit_events")) == 2


def test_a_project_can_be_opened_again(client: TestClient, database_url: str) -> None:
    visit = start(client)
    event(client, visit, type="project_opened", project="alpha-agent")
    event(client, visit, type="project_opened", project="alpha-agent")

    assert len(rows(database_url, "SELECT * FROM visit_events")) == 2


@pytest.mark.parametrize(
    "body",
    [
        {"type": "stage_reached", "stage": "summit"},
        {"type": "stage_reached"},
        {"type": "project_opened", "project": "no-such-project"},
        {"type": "project_opened", "project": "Bad Slug!"},
        {"type": "project_opened"},
        {"type": "page_viewed"},
        {"type": "cv_downloaded", "stage": "ridge"},
        {},
    ],
)
def test_an_invalid_event_is_rejected(
    client: TestClient, database_url: str, body: dict[str, Any]
) -> None:
    visit = start(client)

    assert event(client, visit, **body).status_code == 422
    assert rows(database_url, "SELECT * FROM visit_events") == []


def test_an_unknown_visit_is_refused(client: TestClient) -> None:
    response = event(client, uuid.uuid4(), type="cv_downloaded")

    assert response.status_code == 404


def test_a_malformed_visit_id_is_refused(client: TestClient) -> None:
    response = client.post(
        "/api/v1/visits/not-an-id/events", json={"type": "cv_downloaded"}
    )

    assert response.status_code == 422


def test_a_visit_takes_events_until_the_age_limit(
    client: TestClient, clock: FakeClock, database_url: str
) -> None:
    visit = start(client)

    clock.advance(hours=23, minutes=59)
    assert event(client, visit, type="cv_downloaded").status_code == 204
    clock.advance(minutes=2)
    assert event(client, visit, type="cv_downloaded").status_code == 410
    assert len(rows(database_url, "SELECT * FROM visit_events")) == 1


# The daily Visitor hash


def hash_of(client: TestClient, database_url: str, **headers: str) -> str:
    response = client.post("/api/v1/visits", json=START, headers=headers)
    assert response.status_code == 201
    [row] = rows(
        database_url,
        f"SELECT visitor_hash FROM visits WHERE id = '{response.json()['id']}'",  # noqa: S608
    )
    return row["visitor_hash"]


def test_the_hash_is_stable_within_a_day(client: TestClient, database_url: str) -> None:
    first = hash_of(client, database_url)
    second = hash_of(client, database_url)

    assert first == second


def test_the_hash_differs_by_address_and_by_user_agent(
    client: TestClient, database_url: str
) -> None:
    base = hash_of(client, database_url)

    assert hash_of(client, database_url, **{"x-forwarded-for": OTHER_IP}) != base
    assert hash_of(client, database_url, **{"user-agent": CHROME_UA + " X"}) != base


def test_the_hash_differs_on_the_next_day(
    client: TestClient, clock: FakeClock, database_url: str
) -> None:
    today = hash_of(client, database_url)
    clock.advance(days=1)

    assert hash_of(client, database_url) != today


def test_the_salt_is_made_on_first_use_and_expires(
    client: TestClient, clock: FakeClock, redis: Redis
) -> None:
    assert redis.keys("visitor-salt:*") == []

    start(client)

    [key] = redis.keys("visitor-salt:*")
    assert key == b"visitor-salt:2030-03-14"
    # Noon: twelve hours of the day remain, plus a few minutes of grace.
    assert 12 * 3600 < redis.ttl(key) <= 12 * 3600 + 600


def test_the_salt_reaches_neither_postgres_nor_the_logs(
    client: TestClient,
    redis: Redis,
    database_url: str,
    capsys: pytest.CaptureFixture[str],
) -> None:
    event(client, start(client), type="cv_downloaded")
    salt = redis.get("visitor-salt:2030-03-14")
    assert salt

    tables = [
        r["tablename"]
        for r in rows(
            database_url, "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
        )
    ]
    dump = "".join(
        str(rows(database_url, f'SELECT t::text FROM "{table}" t'))  # noqa: S608
        for table in tables
    )
    assert as_text(salt) not in dump
    assert as_text(salt) not in capsys.readouterr().out


# Referring site, bots, cookies


def test_the_referrer_is_stored_as_a_host_only(
    client: TestClient, database_url: str
) -> None:
    start(client, referrer="https://www.linkedin.com/feed/update?id=42#top")

    assert rows(database_url, "SELECT referrer_host FROM visits") == [
        {"referrer_host": "www.linkedin.com"}
    ]


def test_the_sites_own_referrer_is_dropped(
    client: TestClient, database_url: str
) -> None:
    start(client, referrer="http://testserver/summary")

    assert rows(database_url, "SELECT referrer_host FROM visits") == [
        {"referrer_host": None}
    ]


@pytest.mark.parametrize(
    "bot_agent",
    [
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
        "HeadlessChrome/126.0.0.0 Safari/537.36",
        "curl/8.5.0",
        "python-requests/2.32",
        "Mozilla/5.0 (compatible; bingbot/2.0)",
        "Mozilla/5.0 (compatible; AhrefsBot/7.0)",
        "facebookexternalhit/1.1",
        "Lighthouse",
        "",
    ],
)
def test_a_known_bot_gets_no_visit(
    client: TestClient, database_url: str, bot_agent: str
) -> None:
    response = client.post(
        "/api/v1/visits", json=START, headers={"user-agent": bot_agent}
    )

    assert response.status_code == 204
    assert response.content == b""
    assert rows(database_url, "SELECT * FROM visits") == []


def test_no_cookies_and_no_cors(client: TestClient) -> None:
    visit = client.post(
        "/api/v1/visits", json=START, headers={"origin": "https://elsewhere.example"}
    )
    follow = client.post(
        f"/api/v1/visits/{visit.json()['id']}/events", json={"type": "cv_downloaded"}
    )

    for response in (visit, follow):
        assert "set-cookie" not in response.headers
        assert "access-control-allow-origin" not in response.headers
    assert not client.cookies


# Rate limits


def test_starting_visits_is_rate_limited_per_client(
    visit_client: MAKE_CLIENT, database_url: str
) -> None:
    client = visit_client(visit_start_limit_per_minute=3)

    codes = [client.post("/api/v1/visits", json=START).status_code for _ in range(5)]
    other = client.post(
        "/api/v1/visits", json=START, headers={"x-forwarded-for": OTHER_IP}
    )

    assert codes == [201, 201, 201, 429, 429]
    assert other.status_code == 201
    assert len(rows(database_url, "SELECT * FROM visits")) == 4


def test_the_429_says_when_to_retry(visit_client: MAKE_CLIENT) -> None:
    client = visit_client(visit_start_limit_per_minute=1)
    client.post("/api/v1/visits", json=START)

    response = client.post("/api/v1/visits", json=START)

    assert response.status_code == 429
    assert response.headers["retry-after"] == "60"


def test_events_are_rate_limited_per_client(visit_client: MAKE_CLIENT) -> None:
    client = visit_client(visit_event_limit_per_minute=2)
    visit = start(client)

    codes = [event(client, visit, type="cv_downloaded").status_code for _ in range(4)]

    assert codes == [204, 204, 429, 429]


def test_the_limit_counter_expires(visit_client: MAKE_CLIENT, redis: Redis) -> None:
    client = visit_client(visit_start_limit_per_minute=1)
    client.post("/api/v1/visits", json=START)

    [key] = redis.keys("rate-limit:*")

    assert 0 < redis.ttl(key) <= 60


# Redis down


def test_without_redis_the_visit_is_recorded_without_a_hash(
    visit_client: MAKE_CLIENT, database_url: str, capsys: pytest.CaptureFixture[str]
) -> None:
    client = visit_client(redis_url="redis://127.0.0.1:1/0")

    visit = start(client)
    follow = event(client, visit, type="cv_downloaded")

    assert follow.status_code == 204
    assert rows(database_url, "SELECT visitor_hash FROM visits") == [
        {"visitor_hash": None}
    ]
    out = capsys.readouterr().out
    assert '"level": "warning"' in out
    assert "visitor_hash_unavailable" in out
    assert CLIENT_IP not in out


def test_without_redis_requests_are_not_rate_limited(
    visit_client: MAKE_CLIENT,
) -> None:
    client = visit_client(
        redis_url="redis://127.0.0.1:1/0", visit_start_limit_per_minute=1
    )

    codes = [client.post("/api/v1/visits", json=START).status_code for _ in range(3)]

    assert codes == [201, 201, 201]


# Privacy


def test_the_client_address_is_nowhere_in_storage_or_logs(
    visit_client: MAKE_CLIENT,
    redis: Redis,
    database_url: str,
    capsys: pytest.CaptureFixture[str],
) -> None:
    client = visit_client(visit_start_limit_per_minute=2)
    visit = start(client, referrer="https://news.example/story")
    event(client, visit, type="project_opened", project="alpha-agent")
    event(client, visit, type="project_opened", project="no-such-project")
    client.post("/api/v1/visits", json={"device": "bad"})
    client.post("/api/v1/visits", json=START)
    assert client.post("/api/v1/visits", json=START).status_code == 429
    client.post("/api/v1/visits", json=START, headers={"user-agent": "curl/8"})
    client.post("/api/v1/visits", content=b"{" + b"x" * 5000)

    tables = [
        r["tablename"]
        for r in rows(
            database_url, "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
        )
    ]
    dump = "".join(
        str(rows(database_url, f'SELECT t::text FROM "{table}" t'))  # noqa: S608
        for table in tables
    )
    logs = capsys.readouterr().out
    assert logs  # the request lines are there, so the check below means something
    for where in (dump, redis_dump(redis), logs):
        assert CLIENT_IP not in where


def test_the_address_is_not_logged_when_a_request_fails(
    visit_client: MAKE_CLIENT, capsys: pytest.CaptureFixture[str]
) -> None:
    client = visit_client(database_url="postgresql+asyncpg://nobody:x@127.0.0.1:1/none")

    response = client.post("/api/v1/visits", json=START)

    logs = capsys.readouterr().out
    assert response.status_code == 500
    assert "request_failed" in logs
    assert CLIENT_IP not in logs
    assert CLIENT_IP not in response.text
