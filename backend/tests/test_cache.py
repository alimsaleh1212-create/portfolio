"""The response cache, HTTP caching and cache metrics, on real Postgres and Redis."""

import asyncio
import json
import threading
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from prometheus_client import CollectorRegistry
from redis import Redis
from sqlalchemy import event
from sqlalchemy.engine import Engine

from app.api.v1.http_cache import etag_for, none_match
from app.config import Settings
from app.data.content_repo import ContentRepository
from app.data.response_cache import CACHE_PREFIX, GENERATION_KEY
from app.metrics import CACHED_ENDPOINTS, create_metrics_app, serve_metrics
from app.seed import CacheInvalidationError, invalidate_cache, run_seed, seed_content
from tests.redis_helpers import FlakyRedis

MAKE_CLIENT = Callable[..., TestClient]

ENDPOINTS = {
    "profile": "/api/v1/profile",
    "stages": "/api/v1/stages",
    "projects": "/api/v1/projects",
    "project": "/api/v1/projects/alpha",
    "media": "/api/v1/media",
}


@pytest.fixture
def redis(settings: Settings) -> Iterator[Redis]:
    connection = Redis.from_url(settings.redis_url, decode_responses=True)
    yield connection
    connection.close()


@pytest.fixture
def seeded(empty_database_url: str, content_dir: Path) -> str:
    asyncio.run(seed_content(content_dir, empty_database_url, strict=False))
    return empty_database_url


@pytest.fixture
def api(make_client: MAKE_CLIENT, seeded: str) -> TestClient:
    return make_client(database_url=seeded)


@pytest.fixture
def statements() -> Iterator[list[str]]:
    """Every SQL statement any engine runs while the test is going."""
    seen: list[str] = []

    def record(conn, cursor, statement, *args):  # noqa: ANN001, ANN002, ANN202
        seen.append(statement)

    event.listen(Engine, "before_cursor_execute", record)
    yield seen
    event.remove(Engine, "before_cursor_execute", record)


def entries(redis: Redis) -> list[str]:
    """The cache's entries, leaving out the generation token."""
    keys = redis.keys(f"{CACHE_PREFIX}*")
    return [key for key in keys if key != GENERATION_KEY]  # pyright: ignore[reportReturnType]


def registry_of(client: TestClient) -> CollectorRegistry:
    app = cast(FastAPI, client.app)
    return app.state.metrics_registry


def count(client: TestClient, name: str, **labels: str) -> float:
    registry = registry_of(client)
    return registry.get_sample_value(f"portfolio_cache_{name}_total", labels) or 0.0


def edit(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    assert old in text
    path.write_text(text.replace(old, new))


# --- hit and miss -----------------------------------------------------------


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_a_repeat_request_is_a_hit_and_runs_no_query(
    api: TestClient, statements: list[str], endpoint: str
) -> None:
    url = ENDPOINTS[endpoint]

    first = api.get(url)
    queries_for_the_miss = len(statements)
    second = api.get(url)

    assert first.status_code == second.status_code == 200
    assert queries_for_the_miss > 0
    assert len(statements) == queries_for_the_miss  # the hit asked Postgres nothing
    assert second.content == first.content
    assert count(api, "misses", endpoint=endpoint) == 1
    assert count(api, "hits", endpoint=endpoint) == 1


def test_a_hit_answers_with_postgres_unreachable_after_the_first_request(
    api: TestClient, seeded: str, make_client: MAKE_CLIENT
) -> None:
    body = api.get(ENDPOINTS["stages"]).content
    # A second app sharing the Redis but with no way to reach Postgres.
    offline = make_client(database_url="postgresql+asyncpg://x:y@postgres:1/z")

    response = offline.get(ENDPOINTS["stages"])

    assert response.status_code == 200
    assert response.content == body


def test_the_counters_start_at_zero_for_every_endpoint(api: TestClient) -> None:
    for endpoint in CACHED_ENDPOINTS:
        assert count(api, "hits", endpoint=endpoint) == 0
        assert count(api, "misses", endpoint=endpoint) == 0


def test_each_endpoint_counts_on_its_own(api: TestClient) -> None:
    api.get(ENDPOINTS["profile"])
    api.get(ENDPOINTS["profile"])
    api.get(ENDPOINTS["stages"])

    assert count(api, "hits", endpoint="profile") == 1
    assert count(api, "misses", endpoint="profile") == 1
    assert count(api, "hits", endpoint="stages") == 0
    assert count(api, "misses", endpoint="stages") == 1


def test_the_body_is_the_same_json_the_api_always_served(api: TestClient) -> None:
    body = api.get(ENDPOINTS["projects"]).json()

    assert [project["slug"] for project in body] == ["alpha", "beta"]
    assert api.get(ENDPOINTS["projects"]).headers["content-type"] == "application/json"


def test_not_seeded_is_not_cached(
    make_client: MAKE_CLIENT, empty_database_url: str, redis: Redis
) -> None:
    client = make_client(database_url=empty_database_url)

    assert client.get(ENDPOINTS["profile"]).status_code == 503
    assert [k for k in redis.keys(f"{CACHE_PREFIX}*") if k != GENERATION_KEY] == []


# --- keys -------------------------------------------------------------------


def test_every_entry_sits_under_the_cache_prefix_with_an_expiry(
    api: TestClient, redis: Redis
) -> None:
    for url in ENDPOINTS.values():
        api.get(url)

    keys = redis.keys("*")
    assert keys
    assert all(str(key).startswith(CACHE_PREFIX) for key in keys)
    assert len(entries(redis)) == len(ENDPOINTS)
    assert all(0 < redis.ttl(key) <= 3600 for key in entries(redis))  # pyright: ignore[reportOperatorIssue]


def test_the_cache_holds_no_visitor_data(api: TestClient, redis: Redis) -> None:
    api.get(ENDPOINTS["profile"], headers={"X-Forwarded-For": "203.0.113.9"})

    dump = " ".join(f"{key} {redis.get(key)}" for key in redis.keys("*"))  # pyright: ignore[reportGeneralTypeIssues]
    assert "203.0.113.9" not in dump


# --- invalidation by the seed -----------------------------------------------


def test_the_next_request_after_a_seed_returns_the_new_content(
    make_client: MAKE_CLIENT, cli_settings: Settings, content_dir: Path
) -> None:
    asyncio.run(run_seed(cli_settings, strict=False))
    client = make_client(database_url=cli_settings.database_url)
    before = {name: client.get(url) for name, url in ENDPOINTS.items()}
    assert (
        client.get(ENDPOINTS["stages"]).headers["etag"]
        == before["stages"].headers["etag"]
    )

    edit(content_dir / "stages.yaml", "I studied.", "I studied a lot.")
    edit(content_dir / "projects.yaml", "First project", "First project, revised")
    asyncio.run(run_seed(cli_settings, strict=False))

    stages = client.get(ENDPOINTS["stages"])
    assert stages.json()[0]["body"] == "I studied a lot."
    assert stages.headers["etag"] != before["stages"].headers["etag"]
    assert (
        client.get(ENDPOINTS["project"]).json()["tagline"] == "First project, revised"
    )
    assert (
        client.get(ENDPOINTS["projects"]).json()[0]["tagline"]
        == "First project, revised"
    )
    # What the seed did not change keeps its tag.
    assert (
        client.get(ENDPOINTS["profile"]).headers["etag"]
        == before["profile"].headers["etag"]
    )


def test_a_removed_project_is_gone_on_the_next_request(
    make_client: MAKE_CLIENT, cli_settings: Settings, content_dir: Path
) -> None:
    asyncio.run(run_seed(cli_settings, strict=False))
    client = make_client(database_url=cli_settings.database_url)
    assert client.get("/api/v1/projects/beta").status_code == 200

    projects = (content_dir / "projects.yaml").read_text()
    start = projects.index("- slug: beta") if "- slug: beta" in projects else None
    assert start is not None
    (content_dir / "projects.yaml").write_text(projects[:start])
    asyncio.run(run_seed(cli_settings, strict=False))

    assert client.get("/api/v1/projects/beta").status_code == 404
    assert [p["slug"] for p in client.get(ENDPOINTS["projects"]).json()] == ["alpha"]


def test_a_seed_that_commits_while_a_request_is_loading_cannot_leave_stale_content(
    make_client: MAKE_CLIENT,
    cli_settings: Settings,
    content_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    asyncio.run(run_seed(cli_settings, strict=False))
    client = make_client(database_url=cli_settings.database_url)
    loading = threading.Event()
    release = threading.Event()
    original = ContentRepository.list_stages

    async def slow_list_stages(self: ContentRepository):  # noqa: ANN202
        rows = await original(self)  # reads Postgres: the old content
        loading.set()
        await asyncio.to_thread(release.wait, 10)  # ...then the seed gets in
        return rows

    monkeypatch.setattr(ContentRepository, "list_stages", slow_list_stages)
    results: list[dict] = []
    request = threading.Thread(
        target=lambda: results.append(client.get(ENDPOINTS["stages"]).json()[0])
    )
    request.start()
    assert loading.wait(10)

    edit(content_dir / "stages.yaml", "I studied.", "I studied again.")
    asyncio.run(run_seed(cli_settings, strict=False))  # commits and invalidates
    release.set()
    request.join(10)

    assert results[0]["body"] == "I studied."  # it began before the seed finished
    monkeypatch.undo()
    # The old rows it was holding are not what the next request sees.
    assert client.get(ENDPOINTS["stages"]).json()[0]["body"] == "I studied again."
    assert client.get(ENDPOINTS["stages"]).json()[0]["body"] == "I studied again."


def test_invalidation_does_not_depend_on_the_api_restarting(
    make_client: MAKE_CLIENT, cli_settings: Settings, content_dir: Path
) -> None:
    asyncio.run(run_seed(cli_settings, strict=False))
    first_app = make_client(database_url=cli_settings.database_url)
    second_app = make_client(database_url=cli_settings.database_url)
    first_app.get(ENDPOINTS["stages"])
    second_app.get(ENDPOINTS["stages"])

    edit(content_dir / "stages.yaml", "I built projects.", "I built more.")
    asyncio.run(run_seed(cli_settings, strict=False))

    # Two API processes sharing one Redis both see it, neither restarted.
    assert first_app.get(ENDPOINTS["stages"]).json()[1]["body"] == "I built more."
    assert second_app.get(ENDPOINTS["stages"]).json()[1]["body"] == "I built more."


def test_a_seed_that_cannot_reach_redis_says_so(cli_settings: Settings) -> None:
    broken = cli_settings.model_copy(update={"redis_url": "redis://127.0.0.1:1/15"})

    with pytest.raises(CacheInvalidationError, match="Run the seed again"):
        asyncio.run(invalidate_cache(broken))


def test_clearing_the_cache_leaves_the_salt_and_rate_limits(
    api: TestClient, redis: Redis, settings: Settings
) -> None:
    redis.set("visitor-salt:2030-03-14", "salt", ex=600)
    redis.set("rate-limit:visit-start:abc", 3, ex=60)
    for url in ENDPOINTS.values():
        api.get(url)
    assert len(redis.keys(f"{CACHE_PREFIX}*")) > 1
    generation = redis.get(GENERATION_KEY)

    asyncio.run(_clear(settings))

    assert redis.get("visitor-salt:2030-03-14") == "salt"
    assert redis.get("rate-limit:visit-start:abc") == "3"
    assert redis.ttl("rate-limit:visit-start:abc") > 0
    assert redis.keys(f"{CACHE_PREFIX}*") == [GENERATION_KEY]
    assert redis.get(GENERATION_KEY) != generation


async def _clear(settings: Settings) -> None:
    import os

    from app.clear_cache import clear  # noqa: PLC0415

    os.environ["REDIS_URL"] = settings.redis_url
    from app.config import get_settings

    get_settings.cache_clear()
    try:
        await clear()
    finally:
        get_settings.cache_clear()


# --- HTTP caching -----------------------------------------------------------


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_responses_carry_a_strong_etag_and_ask_browsers_to_revalidate(
    api: TestClient, endpoint: str
) -> None:
    response = api.get(ENDPOINTS[endpoint])

    etag = response.headers["etag"]
    assert etag == etag_for(response.content)
    assert etag.startswith('"') and not etag.startswith("W/")
    assert response.headers["cache-control"] == "no-cache"


def test_the_etag_is_the_same_for_a_miss_and_a_hit(api: TestClient) -> None:
    first = api.get(ENDPOINTS["profile"])
    second = api.get(ENDPOINTS["profile"])

    assert first.headers["etag"] == second.headers["etag"]


def test_a_matching_tag_gets_304_with_no_body(api: TestClient) -> None:
    etag = api.get(ENDPOINTS["stages"]).headers["etag"]

    response = api.get(ENDPOINTS["stages"], headers={"If-None-Match": etag})

    assert response.status_code == 304
    assert response.content == b""
    assert response.headers["etag"] == etag
    assert response.headers["cache-control"] == "no-cache"


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_every_cached_endpoint_answers_304(api: TestClient, endpoint: str) -> None:
    etag = api.get(ENDPOINTS[endpoint]).headers["etag"]

    assert (
        api.get(ENDPOINTS[endpoint], headers={"If-None-Match": etag}).status_code == 304
    )


def test_a_tag_in_a_list_matches(api: TestClient) -> None:
    etag = api.get(ENDPOINTS["stages"]).headers["etag"]

    response = api.get(
        ENDPOINTS["stages"],
        headers={"If-None-Match": f'"other", {etag} , W/"third"'},
    )

    assert response.status_code == 304


def test_a_weak_tag_matches_by_weak_comparison(api: TestClient) -> None:
    etag = api.get(ENDPOINTS["stages"]).headers["etag"]

    response = api.get(ENDPOINTS["stages"], headers={"If-None-Match": f"W/{etag}"})

    assert response.status_code == 304


def test_a_tag_that_does_not_match_gets_the_body(api: TestClient) -> None:
    response = api.get(ENDPOINTS["stages"], headers={"If-None-Match": '"stale"'})

    assert response.status_code == 200
    assert response.json()[0]["key"] == "trailhead"


def test_a_tag_without_quotes_never_matches(api: TestClient) -> None:
    etag = api.get(ENDPOINTS["stages"]).headers["etag"]

    response = api.get(ENDPOINTS["stages"], headers={"If-None-Match": etag.strip('"')})

    assert response.status_code == 200


def test_star_matches_an_existing_resource(api: TestClient) -> None:
    assert (
        api.get(ENDPOINTS["stages"], headers={"If-None-Match": "*"}).status_code == 304
    )


def test_an_old_tag_gets_200_after_the_content_changes(
    make_client: MAKE_CLIENT, cli_settings: Settings, content_dir: Path
) -> None:
    asyncio.run(run_seed(cli_settings, strict=False))
    client = make_client(database_url=cli_settings.database_url)
    old = client.get(ENDPOINTS["stages"]).headers["etag"]

    edit(content_dir / "stages.yaml", "I studied.", "I studied differently.")
    asyncio.run(run_seed(cli_settings, strict=False))

    response = client.get(ENDPOINTS["stages"], headers={"If-None-Match": old})
    assert response.status_code == 200
    assert response.headers["etag"] != old


def test_a_304_is_counted_like_any_other_hit(api: TestClient) -> None:
    etag = api.get(ENDPOINTS["stages"]).headers["etag"]

    api.get(ENDPOINTS["stages"], headers={"If-None-Match": etag})

    assert count(api, "hits", endpoint="stages") == 1


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        (['"a"'], True),
        (['"b", "a"'], True),
        (['W/"a"'], True),
        (['"b","a"'], True),
        (['"b"', '"a"'], True),  # two header lines
        (["*"], True),
        (['"A"'], False),
        (["a"], False),
        (['"ab"'], False),
        ([""], False),
        ([], False),
    ],
)
def test_none_match_follows_the_weak_comparison_rule(
    header: list[str], expected: bool
) -> None:
    assert none_match(header, '"a"') is expected


# --- what is never cached ---------------------------------------------------


@pytest.mark.parametrize(
    ("method", "url"),
    [
        ("GET", "/api/v1/health/live"),
        ("GET", "/api/v1/health/ready"),
        ("POST", "/api/v1/visits"),
        ("POST", "/api/v1/contact"),
        ("GET", "/api/v1/projects/nope"),
        ("GET", "/api/v1/nothing-here"),
    ],
)
def test_everything_else_is_marked_no_store(
    api: TestClient, method: str, url: str
) -> None:
    response = api.request(method, url, json={})

    assert response.headers["cache-control"] == "no-store"
    assert "etag" not in response.headers


def test_validation_errors_and_oversize_bodies_are_marked_no_store(
    api: TestClient,
) -> None:
    invalid = api.post("/api/v1/contact", json={})
    huge = api.post("/api/v1/visits", content=b"x" * 10_000)

    assert invalid.status_code == 422
    assert huge.status_code == 413
    assert invalid.headers["cache-control"] == "no-store"
    assert huge.headers["cache-control"] == "no-store"


def test_no_visitor_endpoint_touches_the_cache(api: TestClient, redis: Redis) -> None:
    api.post("/api/v1/visits", json={"tier": "full"})
    api.get("/api/v1/health/ready")

    assert redis.keys(f"{CACHE_PREFIX}*") == []


# --- unknown slugs ----------------------------------------------------------


def test_unknown_slugs_get_404_and_add_nothing_to_redis(
    api: TestClient, redis: Redis, statements: list[str]
) -> None:
    api.get(ENDPOINTS["projects"])  # one known cache fill
    keys_before = set(redis.keys("*"))
    queries_before = len(statements)

    for i in range(200):
        assert api.get(f"/api/v1/projects/made-up-{i}").status_code == 404

    assert set(redis.keys("*")) == keys_before
    assert len(statements) == queries_before  # not even a database query
    assert api.get("/api/v1/projects/made-up-0").json() == {
        "detail": "Project not found."
    }


@pytest.mark.parametrize(
    "slug", ["UPPER", "has space", "a" * 5000, "x:y", "trail-", "%00", "a--b"]
)
def test_slugs_that_cannot_exist_are_refused_before_redis_is_asked(
    api: TestClient, redis: Redis, slug: str
) -> None:
    assert api.get(f"/api/v1/projects/{slug}").status_code == 404
    assert redis.keys("*") == []


def test_a_known_slug_is_cached_but_only_one_entry_per_project(
    api: TestClient, redis: Redis
) -> None:
    api.get("/api/v1/projects/alpha")
    api.get("/api/v1/projects/beta")
    api.get("/api/v1/projects/alpha")

    names = sorted(key.split(":", 2)[2] for key in entries(redis))
    assert names == ["project:alpha", "project:beta", "projects"]


# --- Redis down and slow ----------------------------------------------------


def warnings(capsys: pytest.CaptureFixture[str]) -> list[dict]:
    lines = [
        line for line in capsys.readouterr().out.splitlines() if line.startswith("{")
    ]
    return [json.loads(line) for line in lines if "cache_unavailable" in line]


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_with_redis_down_every_endpoint_answers_from_postgres(
    make_client: MAKE_CLIENT,
    seeded: str,
    api: TestClient,
    capsys: pytest.CaptureFixture[str],
    endpoint: str,
) -> None:
    expected = api.get(ENDPOINTS[endpoint])
    down = make_client(database_url=seeded, redis_url="redis://127.0.0.1:1/15")
    capsys.readouterr()

    response = down.get(ENDPOINTS[endpoint])

    assert response.status_code == 200
    assert response.content == expected.content
    assert response.headers["etag"] == expected.headers["etag"]
    [warning] = warnings(capsys)
    assert warning["level"] == "warning"
    assert warning["error"]


def test_a_burst_with_redis_down_logs_one_warning(
    make_client: MAKE_CLIENT, seeded: str, capsys: pytest.CaptureFixture[str]
) -> None:
    down = make_client(database_url=seeded, redis_url="redis://127.0.0.1:1/15")
    capsys.readouterr()

    statuses = {down.get(ENDPOINTS["stages"]).status_code for _ in range(50)}

    assert statuses == {200}
    assert len(warnings(capsys)) == 1
    assert count(down, "errors", endpoint="stages", operation="read") == 1
    assert count(down, "errors", endpoint="stages", operation="skipped") == 49
    assert count(down, "hits", endpoint="stages") == 0


def test_a_conditional_request_still_works_with_redis_down(
    make_client: MAKE_CLIENT, seeded: str, api: TestClient
) -> None:
    etag = api.get(ENDPOINTS["stages"]).headers["etag"]
    down = make_client(database_url=seeded, redis_url="redis://127.0.0.1:1/15")

    assert (
        down.get(ENDPOINTS["stages"], headers={"If-None-Match": etag}).status_code
        == 304
    )


def test_a_stalled_redis_does_not_stall_the_page(
    make_client: MAKE_CLIENT,
    seeded: str,
    settings: Settings,
    capsys: pytest.CaptureFixture[str],
) -> None:
    proxy = FlakyRedis(settings.redis_url)
    proxy.start()
    try:
        proxy.set_mode("stalled")
        client = make_client(
            database_url=seeded, redis_url=proxy.url(), cache_timeout_seconds=0.2
        )
        capsys.readouterr()

        started = time.monotonic()
        responses = [client.get(ENDPOINTS["projects"]) for _ in range(20)]
        elapsed = time.monotonic() - started

        assert {r.status_code for r in responses} == {200}
        assert responses[0].json()[0]["slug"] == "alpha"
        # One 0.2 second timeout, then the cache is skipped; never 20 of them.
        assert elapsed < 2.0
        assert len(warnings(capsys)) == 1
    finally:
        proxy.stop()


def test_the_cache_recovers_when_redis_comes_back_without_a_restart(
    make_client: MAKE_CLIENT,
    seeded: str,
    settings: Settings,
    statements: list[str],
    capsys: pytest.CaptureFixture[str],
) -> None:
    proxy = FlakyRedis(settings.redis_url)
    proxy.start()
    try:
        client = make_client(
            database_url=seeded,
            redis_url=proxy.url(),
            cache_timeout_seconds=0.2,
            cache_retry_seconds=0.3,
        )
        client.get(ENDPOINTS["stages"])
        proxy.set_mode("refused")
        assert (
            client.get(ENDPOINTS["stages"]).status_code == 200
        )  # reads fail, falls back
        assert count(client, "errors", endpoint="stages", operation="read") == 1
        mended_at = len(statements)

        proxy.set_mode("forwarding")
        time.sleep(0.5)  # past the cool-down
        client.get(ENDPOINTS["stages"])
        client.get(ENDPOINTS["stages"])

        assert count(client, "hits", endpoint="stages") >= 1
        queries_after = len(statements)
        client.get(ENDPOINTS["stages"])
        assert len(statements) == queries_after
        assert "cache_recovered" in capsys.readouterr().out
        assert mended_at > 0
    finally:
        proxy.stop()


# --- metrics endpoint -------------------------------------------------------


def test_the_metrics_endpoint_exposes_hits_misses_and_errors(api: TestClient) -> None:
    api.get(ENDPOINTS["stages"])
    api.get(ENDPOINTS["stages"])
    registry = registry_of(api)

    metrics = TestClient(create_metrics_app(registry))
    response = metrics.get("/metrics")

    text = response.text
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    assert response.headers["cache-control"] == "no-store"
    assert 'portfolio_cache_hits_total{endpoint="stages"} 1.0' in text
    assert 'portfolio_cache_misses_total{endpoint="stages"} 1.0' in text
    assert (
        'portfolio_cache_errors_total{endpoint="stages",operation="read"} 0.0' in text
    )
    assert 'portfolio_cache_hits_total{endpoint="project"} 0.0' in text


def test_metric_labels_are_a_fixed_list_and_never_a_slug_or_visitor(
    api: TestClient,
) -> None:
    api.get("/api/v1/projects/alpha", headers={"X-Forwarded-For": "203.0.113.9"})
    api.get("/api/v1/projects/made-up")
    registry = registry_of(api)

    text = TestClient(create_metrics_app(registry)).get("/metrics").text

    assert "203.0.113.9" not in text
    assert "made-up" not in text
    assert "alpha" not in text.replace("portfolio_cache", "")


def test_the_metrics_app_serves_only_the_metrics_path(api: TestClient) -> None:
    registry = registry_of(api)

    metrics = TestClient(create_metrics_app(registry))
    assert metrics.get("/").status_code == 404
    assert metrics.get("/api/v1/metrics").status_code == 404
    assert metrics.post("/metrics").status_code == 404


def test_the_api_does_not_serve_metrics_on_its_own_port(api: TestClient) -> None:
    for path in ("/metrics", "/api/metrics", "/api/v1/metrics"):
        assert "portfolio_cache" not in api.get(path).text


def test_the_metrics_server_listens_on_its_own_port(api: TestClient) -> None:
    import socket  # noqa: PLC0415
    import urllib.request  # noqa: PLC0415

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    registry = registry_of(api)

    async def scrape() -> str:
        async with serve_metrics(registry, port, host="127.0.0.1"):
            await asyncio.sleep(0.5)
            return await asyncio.to_thread(
                lambda: (
                    urllib.request.urlopen(  # noqa: S310
                        f"http://127.0.0.1:{port}/metrics", timeout=3
                    )
                    .read()
                    .decode()
                )
            )

    assert "portfolio_cache_hits_total" in asyncio.run(scrape())
