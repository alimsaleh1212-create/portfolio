"""Request ID and JSON logging behaviour."""

import json

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.middleware import resolve_request_id


def test_generates_request_id_when_absent(client: TestClient) -> None:
    response = client.get("/api/v1/health/live")

    assert len(response.headers["X-Request-ID"]) == 32


def test_echoes_inbound_request_id(client: TestClient) -> None:
    response = client.get("/api/v1/health/live", headers={"X-Request-ID": "abc-123"})

    assert response.headers["X-Request-ID"] == "abc-123"


def test_replaces_unsafe_inbound_request_id() -> None:
    assert resolve_request_id('bad id"\n{') != 'bad id"\n{'
    assert resolve_request_id(None)


def test_every_log_line_is_json_with_the_request_id(
    capsys: pytest.CaptureFixture[str], client: TestClient
) -> None:
    # capsys must start before `client`, whose app binds its log handler to stdout.
    client.get("/api/v1/health/ready", headers={"X-Request-ID": "trace-me"})

    lines = [line for line in capsys.readouterr().out.splitlines() if line]
    records = [json.loads(line) for line in lines]
    request_records = [r for r in records if r.get("event") == "request"]
    assert request_records
    assert all(r["request_id"] == "trace-me" for r in request_records)
    assert request_records[0]["path"] == "/api/v1/health/ready"
    assert request_records[0]["status"] == 200


def test_a_failing_request_logs_the_error_class_and_never_its_text(
    capsys: pytest.CaptureFixture[str], settings: Settings
) -> None:
    app = create_app(settings)

    @app.get("/boom")
    async def boom() -> None:  # pyright: ignore[reportUnusedFunction]
        raise ValueError("secret-parameters-marker")

    with TestClient(app) as client:
        response = client.get("/boom")
    out = capsys.readouterr().out

    assert response.status_code == 500
    assert "secret-parameters-marker" not in out
    failed = [json.loads(x) for x in out.splitlines() if "request_failed" in x]
    assert failed[0]["error_type"] == "ValueError"
    assert any("in boom" in frame for frame in failed[0]["frames"])
