"""Contact messages, against real Postgres and Redis and an in-process mail server."""

import asyncio
import time
import uuid
from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from redis import Redis

from app.config import Settings
from app.main import create_app
from tests.db_helpers import execute, fetch_all
from tests.mail_helpers import free_port, mail_server
from tests.visit_helpers import (
    CHROME_UA,
    CLIENT_IP,
    OTHER_IP,
    redis_dump,
    scratch_redis_url,
)

MAKE_CLIENT = Callable[..., TestClient]

# Fictional, and unlikely to appear in any other output.
NAME = "Zelda Quartermain"
EMAIL = "zelda.quartermain@example.org"
TEXT = "The marmalade orbits quietly over the harbour."
VALID = {"name": NAME, "email": EMAIL, "message": TEXT}
PII = (NAME, "Quartermain", EMAIL, "marmalade", "harbour")
SENDER = "site@example.net"
RECIPIENT = "ali@example.net"


@pytest.fixture
def redis(settings: Settings) -> Iterator[Redis]:
    connection = Redis.from_url(scratch_redis_url(settings.redis_url))
    connection.flushdb()
    yield connection
    connection.flushdb()
    connection.close()


@pytest.fixture
def database_url(test_database_url: str) -> str:
    execute(test_database_url, "TRUNCATE contact_messages")
    return test_database_url


@pytest.fixture
def contact_client(
    settings: Settings, database_url: str, redis: Redis
) -> Iterator[MAKE_CLIENT]:
    """Factory for clients on the test database and scratch Redis, with no mail."""
    clients: list[TestClient] = []

    def factory(**overrides: Any) -> TestClient:
        update: dict[str, Any] = {
            "database_url": database_url,
            "redis_url": scratch_redis_url(settings.redis_url),
            "health_check_timeout_seconds": 1.0,
            "smtp_host": None,
            "mail_sender": None,
            "mail_recipient": None,
            **overrides,
        }
        client = TestClient(create_app(settings.model_copy(update=update)))
        client.headers.update({"user-agent": CHROME_UA, "x-forwarded-for": CLIENT_IP})
        client.__enter__()
        clients.append(client)
        return client

    yield factory
    for client in clients:
        client.__exit__(None, None, None)


def stored(database_url: str) -> list[dict[str, Any]]:
    return fetch_all(database_url, "SELECT * FROM contact_messages")


def mail_overrides(port: int, **more: Any) -> dict[str, Any]:
    return {
        "smtp_host": "127.0.0.1",
        "smtp_port": port,
        "smtp_security": "none",
        "mail_sender": SENDER,
        "mail_recipient": RECIPIENT,
        **more,
    }


def assert_no_personal_details(text: str) -> None:
    for item in PII:
        assert item not in text


# Storing


def test_a_valid_message_is_stored(
    contact_client: MAKE_CLIENT, database_url: str
) -> None:
    response = contact_client().post("/api/v1/contact", json=VALID)

    assert response.status_code == 201
    assert response.json() == {"received": True}
    [row] = stored(database_url)
    assert (row["name"], row["email"], row["message"]) == (NAME, EMAIL, TEXT)
    assert row["created_at"] is not None


def test_the_table_has_no_link_to_a_visit(database_url: str) -> None:
    columns = fetch_all(
        database_url,
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name = 'contact_messages'",
    )
    keys = fetch_all(
        database_url,
        "SELECT 1 FROM information_schema.table_constraints "
        "WHERE table_name = 'contact_messages' AND constraint_type = 'FOREIGN KEY'",
    )

    assert {c["column_name"] for c in columns} == {
        "id",
        "created_at",
        "name",
        "email",
        "message",
    }
    assert keys == []


def test_input_is_trimmed_and_line_breaks_in_the_message_are_kept(
    contact_client: MAKE_CLIENT, database_url: str
) -> None:
    body = {
        "name": f"  {NAME} ",
        "email": f" {EMAIL} ",
        "message": "First line of it.\r\nSecond\tline.\n\n  ",
    }

    assert contact_client().post("/api/v1/contact", json=body).status_code == 201

    [row] = stored(database_url)
    assert row["name"] == NAME
    assert row["email"] == EMAIL
    assert row["message"] == "First line of it.\nSecond\tline."


def test_non_ascii_names_and_messages_are_accepted(
    contact_client: MAKE_CLIENT, database_url: str
) -> None:
    body = {**VALID, "name": "Zoë Ångström", "message": "Bonjour, ça va très bien ?"}

    assert contact_client().post("/api/v1/contact", json=body).status_code == 201
    assert stored(database_url)[0]["name"] == "Zoë Ångström"


# Validation


@pytest.mark.parametrize(
    ("changes", "field"),
    [
        ({"name": ""}, "name"),
        ({"name": "   "}, "name"),
        ({"name": "x" * 101}, "name"),
        ({"name": "Zelda\nBcc: someone@example.com"}, "name"),
        ({"name": "Zelda\rBcc: someone@example.com"}, "name"),
        ({"name": "Zel\x00da"}, "name"),
        ({"name": "Zel da"}, "name"),
        ({"email": ""}, "email"),
        ({"email": "not-an-address"}, "email"),
        ({"email": "a@b"}, "email"),
        ({"email": "zelda@example.org\nBcc: someone@example.com"}, "email"),
        ({"email": "Zelda <zelda@example.org>"}, "email"),
        ({"email": "a@example.org, b@example.org"}, "email"),
        ({"email": f"{'a' * 250}@example.org"}, "email"),
        ({"message": ""}, "message"),
        ({"message": "short"}, "message"),
        ({"message": "x" * 4001}, "message"),
        ({"message": "Hello there\x00 friend"}, "message"),
        ({"message": "Hello there\x1b[31m friend"}, "message"),
        ({"name": 12}, "name"),
        ({"message": None}, "message"),
    ],
)
def test_each_invalid_field_is_refused_beside_its_name(
    contact_client: MAKE_CLIENT,
    database_url: str,
    changes: dict[str, Any],
    field: str,
) -> None:
    response = contact_client().post("/api/v1/contact", json={**VALID, **changes})

    assert response.status_code == 422
    errors = response.json()["errors"]
    assert list(errors) == [field]
    assert errors[field]
    assert stored(database_url) == []


@pytest.mark.parametrize("missing", ["name", "email", "message"])
def test_a_missing_field_is_refused(contact_client: MAKE_CLIENT, missing: str) -> None:
    body = {k: v for k, v in VALID.items() if k != missing}

    response = contact_client().post("/api/v1/contact", json=body)

    assert response.status_code == 422
    assert list(response.json()["errors"]) == [missing]


def test_every_failing_field_is_reported_at_once(contact_client: MAKE_CLIENT) -> None:
    response = contact_client().post(
        "/api/v1/contact", json={"name": "", "email": "nope", "message": "hi"}
    )

    assert set(response.json()["errors"]) == {"name", "email", "message"}


def test_a_refusal_never_echoes_the_input(contact_client: MAKE_CLIENT) -> None:
    response = contact_client().post(
        "/api/v1/contact", json={**VALID, "email": "marmalade-not-an-address"}
    )

    assert response.status_code == 422
    assert_no_personal_details(response.text)
    assert "marmalade" not in response.text


def test_a_body_that_is_not_json_is_refused(contact_client: MAKE_CLIENT) -> None:
    response = contact_client().post(
        "/api/v1/contact",
        content=b"{not json",
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 422


def test_an_unknown_field_is_refused(contact_client: MAKE_CLIENT) -> None:
    response = contact_client().post("/api/v1/contact", json={**VALID, "visit": "x"})

    assert response.status_code == 422


def test_a_long_message_fits_the_body_limit_and_a_huge_body_does_not(
    contact_client: MAKE_CLIENT, database_url: str
) -> None:
    client = contact_client()
    long_message = {**VALID, "message": "é" * 4000}

    ok = client.post("/api/v1/contact", json=long_message)
    huge = client.post("/api/v1/contact", json={**VALID, "message": "x" * 40000})

    assert ok.status_code == 201
    assert huge.status_code == 413
    assert len(stored(database_url)) == 1


# Honeypot


def test_a_filled_honeypot_gets_the_success_answer_and_stores_nothing(
    contact_client: MAKE_CLIENT, database_url: str
) -> None:
    client = contact_client()
    real = client.post("/api/v1/contact", json=VALID)
    execute(database_url, "TRUNCATE contact_messages")

    trapped = client.post(
        "/api/v1/contact", json={**VALID, "website": "https://spam.example"}
    )

    assert trapped.status_code == real.status_code == 201
    assert trapped.json() == real.json()
    assert dict(trapped.headers).keys() - {"x-request-id"} == dict(
        real.headers
    ).keys() - {"x-request-id"}
    assert stored(database_url) == []


def test_a_filled_honeypot_sends_no_email(contact_client: MAKE_CLIENT) -> None:
    with mail_server() as (port, inbox):
        client = contact_client(**mail_overrides(port))
        client.post("/api/v1/contact", json={**VALID, "website": "x"})

    assert inbox.messages == []


def test_an_empty_honeypot_is_an_ordinary_message(
    contact_client: MAKE_CLIENT, database_url: str
) -> None:
    contact_client().post("/api/v1/contact", json={**VALID, "website": ""})

    assert len(stored(database_url)) == 1


# Rate limit


def test_messages_beyond_the_limit_are_refused(
    contact_client: MAKE_CLIENT, database_url: str
) -> None:
    client = contact_client(contact_limit_per_hour=2)

    codes = [client.post("/api/v1/contact", json=VALID).status_code for _ in range(4)]
    other = client.post(
        "/api/v1/contact", json=VALID, headers={"x-forwarded-for": OTHER_IP}
    )

    assert codes == [201, 201, 429, 429]
    assert other.status_code == 201
    assert len(stored(database_url)) == 3


def test_the_refusal_says_when_to_try_again(contact_client: MAKE_CLIENT) -> None:
    client = contact_client(contact_limit_per_hour=1)
    client.post("/api/v1/contact", json=VALID)

    response = client.post("/api/v1/contact", json=VALID)

    assert response.status_code == 429
    assert response.headers["retry-after"] == "3600"
    assert "hour" in response.json()["detail"]


def test_the_counter_lives_for_an_hour_and_holds_no_address(
    contact_client: MAKE_CLIENT, redis: Redis
) -> None:
    contact_client().post("/api/v1/contact", json=VALID)

    [key] = redis.keys("rate-limit:contact:*")

    assert 3500 < redis.ttl(key) <= 3600
    assert CLIENT_IP not in redis_dump(redis)


def test_invalid_input_does_not_use_up_the_limit(
    contact_client: MAKE_CLIENT, redis: Redis
) -> None:
    client = contact_client(contact_limit_per_hour=1)
    client.post("/api/v1/contact", json={**VALID, "email": "nope"})

    assert client.post("/api/v1/contact", json=VALID).status_code == 201


def test_messages_have_their_own_limit_apart_from_visits(
    contact_client: MAKE_CLIENT,
) -> None:
    client = contact_client(contact_limit_per_hour=1)
    for _ in range(3):
        client.post("/api/v1/visits", json={"device": "desktop"})

    assert client.post("/api/v1/contact", json=VALID).status_code == 201


def test_without_redis_messages_go_through(
    contact_client: MAKE_CLIENT, database_url: str
) -> None:
    client = contact_client(redis_url="redis://127.0.0.1:1/0", contact_limit_per_hour=1)

    codes = [client.post("/api/v1/contact", json=VALID).status_code for _ in range(3)]

    assert codes == [201, 201, 201]
    assert len(stored(database_url)) == 3


# Delivery


def test_with_mail_settings_the_message_reaches_the_server(
    contact_client: MAKE_CLIENT,
) -> None:
    with mail_server() as (port, inbox):
        response = contact_client(**mail_overrides(port)).post(
            "/api/v1/contact", json=VALID
        )

    assert response.status_code == 201
    [mail] = inbox.messages
    assert mail["From"] == SENDER
    assert mail["To"] == RECIPIENT
    assert mail["Reply-To"] == EMAIL
    assert mail["Subject"] == f"Portfolio message from {NAME}"
    body = mail.get_payload(decode=True).decode()  # pyright: ignore[reportAttributeAccessIssue, reportOptionalMemberAccess]
    assert TEXT in body
    assert inbox.envelopes == [(SENDER, [RECIPIENT])]


def test_the_email_names_the_stored_message(
    contact_client: MAKE_CLIENT, database_url: str
) -> None:
    with mail_server() as (port, inbox):
        contact_client(**mail_overrides(port)).post("/api/v1/contact", json=VALID)

    [row] = stored(database_url)
    assert inbox.messages[0]["X-Portfolio-Message-ID"] == str(row["id"])


def test_credentials_are_used_when_given(contact_client: MAKE_CLIENT) -> None:
    with mail_server(users={"mailer": "s3cret-pass"}) as (port, inbox):
        contact_client(
            **mail_overrides(port, smtp_username="mailer", smtp_password="s3cret-pass")
        ).post("/api/v1/contact", json=VALID)

    assert inbox.logins == [("mailer", "s3cret-pass")]
    assert len(inbox.messages) == 1


def test_wrong_credentials_fail_the_delivery_but_not_the_request(
    contact_client: MAKE_CLIENT, database_url: str
) -> None:
    with mail_server(users={"mailer": "right"}) as (port, inbox):
        response = contact_client(
            **mail_overrides(port, smtp_username="mailer", smtp_password="wrong")
        ).post("/api/v1/contact", json=VALID)

    assert response.status_code == 201
    assert inbox.messages == []
    assert len(stored(database_url)) == 1


@pytest.mark.parametrize("missing", ["smtp_host", "mail_sender", "mail_recipient"])
def test_without_full_mail_settings_nothing_is_sent_and_nothing_fails(
    contact_client: MAKE_CLIENT, database_url: str, missing: str
) -> None:
    with mail_server() as (port, inbox):
        response = contact_client(**mail_overrides(port, **{missing: None})).post(
            "/api/v1/contact", json=VALID
        )

    assert response.status_code == 201
    assert inbox.messages == []
    assert len(stored(database_url)) == 1


def test_with_no_mail_settings_the_message_is_only_stored(
    contact_client: MAKE_CLIENT, database_url: str
) -> None:
    response = contact_client().post("/api/v1/contact", json=VALID)

    assert response.status_code == 201
    assert len(stored(database_url)) == 1


def test_a_mail_server_that_is_down_does_not_fail_the_request(
    contact_client: MAKE_CLIENT, database_url: str
) -> None:
    client = contact_client(**mail_overrides(free_port()))

    response = client.post("/api/v1/contact", json=VALID)

    assert response.status_code == 201
    assert len(stored(database_url)) == 1


def test_a_mail_server_that_refuses_the_message_does_not_fail_the_request(
    contact_client: MAKE_CLIENT, database_url: str
) -> None:
    with mail_server(reply="554 Transaction failed") as (port, inbox):
        response = contact_client(**mail_overrides(port)).post(
            "/api/v1/contact", json=VALID
        )

    assert response.status_code == 201
    assert inbox.messages == []
    assert len(stored(database_url)) == 1


def test_a_mail_server_that_hangs_is_given_up_on(
    contact_client: MAKE_CLIENT, database_url: str
) -> None:
    import socket

    with socket.socket() as hung:
        hung.bind(("127.0.0.1", 0))
        hung.listen(1)
        client = contact_client(
            **mail_overrides(hung.getsockname()[1], smtp_timeout_seconds=0.5)
        )
        started = time.monotonic()

        response = client.post("/api/v1/contact", json=VALID)

    assert response.status_code == 201
    assert time.monotonic() - started < 5
    assert len(stored(database_url)) == 1


def test_delivery_does_not_delay_the_response(
    settings: Settings, database_url: str, redis: Redis
) -> None:
    """The response is fully sent while the (slow) delivery is still running."""

    async def run(port: int) -> tuple[float, float]:
        update = {
            "database_url": database_url,
            "redis_url": scratch_redis_url(settings.redis_url),
            **mail_overrides(port),
        }
        app = create_app(settings.model_copy(update=update))
        body = (
            b'{"name":"Zelda Quartermain","email":"zelda.quartermain@example.org",'
            b'"message":"The marmalade orbits quietly over the harbour."}'
        )
        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "POST",
            "path": "/api/v1/contact",
            "raw_path": b"/api/v1/contact",
            "query_string": b"",
            "root_path": "",
            "scheme": "http",
            "server": ("test", 80),
            "client": ("127.0.0.1", 1),
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
                (b"user-agent", CHROME_UA.encode()),
            ],
        }
        sent = False

        async def receive() -> dict[str, Any]:
            nonlocal sent
            if sent:
                await asyncio.sleep(10)
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}

        started = time.monotonic()
        answered = 0.0

        async def send(message: dict[str, Any]) -> None:
            nonlocal answered
            if message["type"] == "http.response.body" and not message.get("more_body"):
                answered = time.monotonic() - started

        async with app.router.lifespan_context(app):
            await app(scope, receive, send)  # pyright: ignore[reportArgumentType]
            finished = time.monotonic() - started
        return answered, finished

    with mail_server(delay=1.0) as (port, inbox):
        answered, finished = asyncio.run(run(port))

    assert answered < 0.6
    assert finished >= 1.0
    assert len(inbox.messages) == 1


# Header injection


def test_a_name_with_a_line_break_cannot_add_a_header(
    contact_client: MAKE_CLIENT,
) -> None:
    with mail_server() as (port, inbox):
        response = contact_client(**mail_overrides(port)).post(
            "/api/v1/contact",
            json={**VALID, "name": "Zelda\r\nBcc: victim@example.com"},
        )

    assert response.status_code == 422
    assert inbox.messages == []


def test_an_address_with_a_line_break_cannot_add_a_header(
    contact_client: MAKE_CLIENT,
) -> None:
    with mail_server() as (port, inbox):
        response = contact_client(**mail_overrides(port)).post(
            "/api/v1/contact",
            json={**VALID, "email": "zelda@example.org\r\nBcc: victim@example.com"},
        )

    assert response.status_code == 422
    assert inbox.messages == []


def test_the_mailer_refuses_injection_even_if_validation_is_skipped() -> None:
    from app.services.mailer import MailSettings, build_email

    settings = MailSettings("h", 25, "none", SENDER, RECIPIENT, 1.0)

    mail = build_email(
        settings,
        uuid.uuid4(),
        "Zelda\r\nBcc: victim@example.com",
        "zelda@example.org",
        TEXT,
    )

    assert mail["Bcc"] is None
    assert "\n" not in mail["Subject"]
    assert mail["Subject"] == "Portfolio message from Zelda Bcc: victim@example.com"
    with pytest.raises(ValueError, match="single address"):
        build_email(
            settings, uuid.uuid4(), NAME, "a@example.org\r\nBcc: v@example.com", TEXT
        )
    with pytest.raises(ValueError, match="single address"):
        build_email(settings, uuid.uuid4(), NAME, "a@example.org, b@example.org", TEXT)


# Logs and storage


def test_the_arrival_is_logged_by_id_without_personal_details(
    contact_client: MAKE_CLIENT,
    database_url: str,
    capsys: pytest.CaptureFixture[str],
) -> None:
    with mail_server() as (port, _inbox):
        contact_client(**mail_overrides(port)).post("/api/v1/contact", json=VALID)

    logs = capsys.readouterr().out
    [row] = stored(database_url)
    assert f'"message_id": "{row["id"]}"' in logs
    assert "contact_message_received" in logs
    assert '"attempted": true' in logs
    assert '"delivered": true' in logs
    assert_no_personal_details(logs)
    assert CLIENT_IP not in logs


def test_no_log_line_carries_personal_details_on_any_path(
    contact_client: MAKE_CLIENT,
    capsys: pytest.CaptureFixture[str],
    settings: Settings,
) -> None:
    unreachable = contact_client(**mail_overrides(free_port()))
    unreachable.post("/api/v1/contact", json=VALID)
    with mail_server(reply="554 Transaction failed") as (port, _):
        contact_client(**mail_overrides(port)).post("/api/v1/contact", json=VALID)
    with mail_server(users={"mailer": "right"}) as (port, _):
        contact_client(
            **mail_overrides(port, smtp_username="mailer", smtp_password="bad")
        ).post("/api/v1/contact", json=VALID)
    plain = contact_client()
    plain.post("/api/v1/contact", json=VALID)
    plain.post("/api/v1/contact", json={**VALID, "email": "zelda-bad"})
    plain.post("/api/v1/contact", json={**VALID, "name": "Zelda\nBcc: a@b.co"})
    plain.post("/api/v1/contact", json={**VALID, "website": "spam"})
    plain.post("/api/v1/contact", content=b"{" + TEXT.encode() * 9000)
    limited = contact_client(contact_limit_per_hour=1)
    limited.post("/api/v1/contact", json=VALID, headers={"x-forwarded-for": OTHER_IP})
    assert (
        limited.post(
            "/api/v1/contact", json=VALID, headers={"x-forwarded-for": OTHER_IP}
        ).status_code
        == 429
    )
    no_redis = contact_client(redis_url="redis://127.0.0.1:1/0")
    no_redis.post("/api/v1/contact", json=VALID)
    no_database = contact_client(
        database_url="postgresql+asyncpg://nobody:x@127.0.0.1:1/none"
    )
    failed = no_database.post("/api/v1/contact", json=VALID)

    logs = capsys.readouterr().out
    assert failed.status_code == 503
    assert_no_personal_details(failed.text)
    assert "contact_delivery_failed" in logs
    assert "contact_honeypot_filled" in logs
    assert '"status": 429' in logs
    assert_no_personal_details(logs)
    for address in (CLIENT_IP, OTHER_IP):
        assert address not in logs


def test_a_database_error_does_not_leak_the_message_into_logs(
    contact_client: MAKE_CLIENT,
    database_url: str,
    capsys: pytest.CaptureFixture[str],
) -> None:
    # A column too narrow for the name makes the database refuse the insert with
    # an error whose text carries the statement's parameters.
    execute(
        database_url, "ALTER TABLE contact_messages ALTER COLUMN name TYPE varchar(5)"
    )
    try:
        response = contact_client().post("/api/v1/contact", json=VALID)
    finally:
        execute(
            database_url,
            "ALTER TABLE contact_messages ALTER COLUMN name TYPE varchar(100)",
        )

    logs = capsys.readouterr().out
    assert response.status_code == 503
    assert_no_personal_details(logs)
    assert_no_personal_details(response.text)


def test_redis_holds_no_personal_details(
    contact_client: MAKE_CLIENT, redis: Redis
) -> None:
    contact_client().post("/api/v1/contact", json=VALID)

    assert_no_personal_details(redis_dump(redis))
