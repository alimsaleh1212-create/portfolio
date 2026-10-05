"""Shared fixtures. Integration tests use the real Compose services."""

from collections.abc import Callable, Iterator

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app


@pytest.fixture(scope="session")
def settings() -> Settings:
    """Settings from the environment, which points at the Compose services."""
    return get_settings().model_copy(update={"health_check_timeout_seconds": 1.0})


@pytest.fixture
def make_client(settings: Settings) -> Iterator[Callable[..., TestClient]]:
    """Return a factory building a started client; closes them afterwards."""
    clients: list[TestClient] = []

    def factory(**overrides: str) -> TestClient:
        client = TestClient(create_app(settings.model_copy(update=overrides)))
        client.__enter__()
        clients.append(client)
        return client

    yield factory
    for client in clients:
        client.__exit__(None, None, None)


@pytest.fixture
def client(make_client: Callable[..., TestClient]) -> TestClient:
    """A client against the real Postgres, Redis and MinIO."""
    return make_client()
