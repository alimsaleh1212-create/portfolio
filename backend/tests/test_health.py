"""Health endpoint tests against the real Postgres, Redis and MinIO."""

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient


def test_live_reports_ok(client: TestClient) -> None:
    response = client.get("/api/v1/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_ready_reports_every_dependency_healthy(client: TestClient) -> None:
    response = client.get("/api/v1/health/ready")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "checks": {
            "postgres": {"status": "ok", "detail": None},
            "redis": {"status": "ok", "detail": None},
            "minio": {"status": "ok", "detail": None},
        },
    }


# Pointing one setting at a closed port makes that real dependency unreachable.
BROKEN_SETTING = {
    "postgres": {"database_url": "postgresql+asyncpg://x:y@postgres:1/z"},
    "redis": {"redis_url": "redis://redis:1/0"},
    "minio": {"minio_endpoint": "http://minio:1"},
}


@pytest.mark.parametrize("broken", ["postgres", "redis", "minio"])
def test_ready_fails_only_for_the_broken_dependency(
    make_client: Callable[..., TestClient], broken: str
) -> None:
    client = make_client(**BROKEN_SETTING[broken])

    response = client.get("/api/v1/health/ready")

    body = response.json()
    assert response.status_code == 503
    assert body["status"] == "fail"
    statuses = {name: check["status"] for name, check in body["checks"].items()}
    expected = {name: "ok" for name in BROKEN_SETTING}
    expected[broken] = "fail"
    assert statuses == expected


def test_ready_failure_detail_hides_internals(
    make_client: Callable[..., TestClient],
) -> None:
    client = make_client(**BROKEN_SETTING["postgres"])

    body = client.get("/api/v1/health/ready").json()

    assert body["checks"]["postgres"]["detail"] == "unavailable"
