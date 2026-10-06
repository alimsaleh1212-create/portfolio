"""Tracing and request metrics, and proof that no Visitor data reaches them."""

import json
import uuid
from collections.abc import Iterator
from typing import Any, cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from prometheus_client.exposition import generate_latest
from redis import Redis

from app.config import Settings
from app.main import create_app
from app.telemetry import create_tracer_provider
from tests.db_helpers import fetch_all
from tests.visit_helpers import (
    CHROME_UA,
    CLIENT_IP,
    IPV6,
    OTHER_IP,
    as_text,
    redis_dump,
    scratch_redis_url,
    seed_content_rows,
)

NAME = "Zelda Quartermain"
EMAIL = "zelda.quartermain@example.org"
TEXT = "The marmalade orbits quietly over the harbour."
REFERRER_HOST = "news.example"
SECRETS = (
    CLIENT_IP,
    IPV6,
    CHROME_UA,
    "Chrome/126",
    "Mozilla",
    "X11",
    NAME,
    "Quartermain",
    EMAIL,
    "marmalade",
    "harbour",
    REFERRER_HOST,
)


@pytest.fixture
def exporter() -> InMemorySpanExporter:
    return InMemorySpanExporter()


@pytest.fixture
def redis(settings: Settings) -> Iterator[Redis]:
    connection = Redis.from_url(scratch_redis_url(settings.redis_url))
    connection.flushdb()
    yield connection
    connection.flushdb()
    connection.close()


@pytest.fixture
def traced_client(
    settings: Settings, test_database_url: str, redis: Redis, exporter: Any
) -> Iterator[TestClient]:
    seed_content_rows(test_database_url)
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    app = create_app(
        settings.model_copy(
            update={
                "database_url": test_database_url,
                "redis_url": scratch_redis_url(settings.redis_url),
                "health_check_timeout_seconds": 1.0,
                "contact_limit_per_hour": 1000,
            }
        ),
        tracer_provider=provider,
    )
    with TestClient(app) as client:
        client.headers.update(
            {
                "user-agent": CHROME_UA,
                "x-forwarded-for": f"{CLIENT_IP}, {OTHER_IP}",
                "referer": f"https://{REFERRER_HOST}/page?q=secret",
            }
        )
        yield client


def metrics_text(client: TestClient) -> str:
    app = cast(FastAPI, client.app)
    return generate_latest(app.state.metrics_registry).decode()


def spans_text(exporter: InMemorySpanExporter) -> str:
    """Everything an exporter would send, as one searchable string."""
    return "\n".join(span.to_json() for span in exporter.get_finished_spans())


def use_the_site(client: TestClient) -> uuid.UUID:
    started = client.post(
        "/api/v1/visits",
        json={
            "device": "desktop",
            "tier": "full",
            "referrer": f"https://{REFERRER_HOST}/page?q=secret",
        },
    )
    assert started.status_code == 201
    visit = uuid.UUID(started.json()["id"])
    for body in (
        {"type": "stage_reached", "stage": "ridge"},
        {"type": "project_opened", "project": "alpha-agent"},
        {"type": "cv_downloaded"},
    ):
        assert (
            client.post(f"/api/v1/visits/{visit}/events", json=body).status_code == 204
        )
    message = {"name": NAME, "email": EMAIL, "message": TEXT}
    assert client.post("/api/v1/contact", json=message).status_code == 201
    # A refused message and an unknown path, which are the error paths.
    assert (
        client.post("/api/v1/contact", json={**message, "email": "no"}).status_code
        == 422
    )
    assert client.get("/api/v1/nowhere").status_code == 404
    return visit


def test_requests_are_spans_named_by_route_template(
    traced_client: TestClient, exporter: InMemorySpanExporter
) -> None:
    visit = use_the_site(traced_client)

    server = [s for s in exporter.get_finished_spans() if s.parent is None]
    names = {s.name for s in server}
    assert "POST /api/v1/visits/{visit_id}/events" in names
    assert "POST /api/v1/contact" in names
    assert "GET unmatched" in names
    assert str(visit) not in spans_text(exporter)


def test_server_spans_carry_only_method_route_and_status(
    traced_client: TestClient, exporter: InMemorySpanExporter
) -> None:
    use_the_site(traced_client)

    for span in exporter.get_finished_spans():
        if span.parent is None:
            assert set(span.attributes or {}) == {
                "http.request.method",
                "http.route",
                "http.response.status_code",
            }


def test_database_and_redis_calls_are_child_spans_without_statements(
    traced_client: TestClient, exporter: InMemorySpanExporter
) -> None:
    use_the_site(traced_client)

    spans = exporter.get_finished_spans()
    db = [s for s in spans if (s.attributes or {}).get("db.system") == "postgresql"]
    cache = [s for s in spans if (s.attributes or {}).get("db.system") == "redis"]
    assert db and cache
    assert all(s.parent is not None for s in db + cache)
    for span in db + cache:
        assert set(span.attributes or {}) <= {"db.system", "db.operation", "error.type"}
    assert {str((s.attributes or {})["db.operation"]) for s in db} >= {
        "INSERT",
        "SELECT",
    }


def test_no_visitor_data_in_any_span_or_metric(
    traced_client: TestClient,
    exporter: InMemorySpanExporter,
    redis: Redis,
    test_database_url: str,
) -> None:
    use_the_site(traced_client)

    hashes = [
        r["visitor_hash"] for r in fetch_all(test_database_url, "SELECT * FROM visits")
    ]
    salts = [as_text(redis.get(key)) for key in redis.scan_iter("visitor-salt:*")]
    rate_keys = [as_text(key) for key in redis.scan_iter("rate-limit:*")]
    assert hashes and salts and rate_keys
    forbidden = [*SECRETS, *hashes, *salts, *rate_keys]
    exported = spans_text(exporter)
    metrics = metrics_text(traced_client)
    for item in forbidden:
        assert item not in exported, item
        assert item not in metrics, item
    # The salt is in Redis (so the search is meaningful) and nowhere else.
    assert salts[0] in redis_dump(redis)


def test_every_log_line_in_a_request_has_the_trace_id(
    traced_client: TestClient,
    exporter: InMemorySpanExporter,
    capsys: pytest.CaptureFixture[str],
) -> None:
    traced_client.get("/api/v1/health/ready", headers={"X-Request-ID": "find-me"})

    records = [
        json.loads(line) for line in capsys.readouterr().out.splitlines() if line
    ]
    request_lines = [r for r in records if r.get("request_id") == "find-me"]
    assert request_lines
    root = next(s for s in exporter.get_finished_spans() if s.parent is None)
    expected = format(root.context.trace_id, "032x")  # pyright: ignore[reportOptionalMemberAccess]
    assert all(r["trace_id"] == expected for r in request_lines)


def test_the_liveness_check_is_counted_but_not_traced(
    traced_client: TestClient, exporter: InMemorySpanExporter
) -> None:
    traced_client.get("/api/v1/health/live")

    assert not exporter.get_finished_spans()
    assert (
        'portfolio_http_requests_total{method="GET",route="/api/v1/health/live",'
        'status="200"} 1.0' in metrics_text(traced_client)
    )


def test_metric_labels_use_the_route_template_never_the_raw_path(
    traced_client: TestClient,
) -> None:
    visit = use_the_site(traced_client)
    traced_client.get("/api/v1/projects/no-such-project-slug")
    traced_client.request("BREW", "/api/v1/health/live")

    text = metrics_text(traced_client)
    assert str(visit) not in text
    assert "no-such-project-slug" not in text
    assert 'route="/api/v1/visits/{visit_id}/events"' in text
    assert 'route="unmatched"' in text
    assert 'method="OTHER"' in text
    assert "portfolio_http_request_duration_seconds_bucket" in text


def test_pool_state_is_exposed(traced_client: TestClient) -> None:
    traced_client.get("/api/v1/health/ready")

    text = metrics_text(traced_client)
    assert 'portfolio_db_pool_connections{state="in_use"}' in text
    assert 'portfolio_db_pool_connections{state="idle"}' in text
    assert "portfolio_db_pool_max_connections 15.0" in text


def test_a_failing_query_records_the_error_class_and_no_text(
    settings: Settings, exporter: InMemorySpanExporter, test_database_url: str
) -> None:
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    broken = settings.model_copy(
        update={"database_url": test_database_url.replace("/portfolio_test", "/nope")}
    )
    with TestClient(create_app(broken, tracer_provider=provider)) as client:
        client.get("/api/v1/stages", headers={"user-agent": CHROME_UA})

    assert CHROME_UA not in spans_text(exporter)
    assert "nope" not in spans_text(exporter)
    assert "password" not in spans_text(exporter).lower()


def test_without_an_endpoint_nothing_is_exported() -> None:
    provider = create_tracer_provider(None)

    assert not provider._active_span_processor._span_processors  # pyright: ignore[reportAttributeAccessIssue,reportPrivateUsage]


def test_with_an_endpoint_the_exporter_posts_to_the_traces_path() -> None:
    provider = create_tracer_provider("http://collector:4318/")

    [processor] = provider._active_span_processor._span_processors  # pyright: ignore[reportAttributeAccessIssue,reportPrivateUsage]
    assert processor.span_exporter._endpoint == "http://collector:4318/v1/traces"  # pyright: ignore[reportAttributeAccessIssue]
    provider.shutdown()


def test_fastapis_own_telemetry_stays_off_even_with_an_endpoint_in_the_environment(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    # FastAPI would otherwise attach exporters for traces, metrics and logs to
    # the global providers, with validation input and exception messages in them.
    from fastapi.telemetry import _runtime  # pyright: ignore[reportMissingImports]
    from opentelemetry import trace

    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector.invalid:4318")
    before = list(_runtime._owned)  # pyright: ignore[reportPrivateUsage]

    with TestClient(create_app(settings)) as client:
        client.get("/api/v1/health/live")

    assert list(_runtime._owned) == before  # pyright: ignore[reportPrivateUsage]
    assert not isinstance(trace.get_tracer_provider(), TracerProvider)


def test_every_documented_route_and_status_starts_at_zero(
    traced_client: TestClient,
) -> None:
    # Without a zero to start from, Prometheus would miss the first 500.
    text = metrics_text(traced_client)

    assert (
        'portfolio_http_requests_total{method="POST",route="/api/v1/visits",'
        'status="500"} 0.0' in text
    )
    assert (
        'portfolio_http_requests_total{method="GET",route="/api/v1/projects/{slug}",'
        'status="404"} 0.0' in text
    )
