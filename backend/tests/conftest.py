"""Shared fixtures. Integration tests use the real Compose services."""

import asyncio
import os
import shutil
import subprocess
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.engine import make_url

from app.config import Settings, get_settings
from app.main import create_app
from tests.db_helpers import drop_database, execute, recreate_database


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


FIXTURE_CONTENT = Path(__file__).parent / "fixtures" / "content"
BACKEND_DIR = Path(__file__).parents[1]


@pytest.fixture(scope="session")
def test_database_url(settings: Settings) -> Iterator[str]:
    """URL of a throwaway `<database>_test` database with migrations applied.

    Content tests write and truncate tables, so they never touch the database the
    development stack serves. The database is created fresh for the session and
    dropped at the end.
    """
    url = make_url(settings.database_url)
    test_name = f"{url.database}_test"
    asyncio.run(recreate_database(url.set(database="postgres"), test_name))
    test_url = url.set(database=test_name).render_as_string(hide_password=False)
    # A subprocess keeps Alembic's cached settings pointed at the test database.
    subprocess.run(  # noqa: S603
        ["alembic", "upgrade", "head"],  # noqa: S607
        cwd=BACKEND_DIR,
        env={**os.environ, "DATABASE_URL": test_url},
        check=True,
    )
    yield test_url
    asyncio.run(drop_database(url.set(database="postgres"), test_name))


@pytest.fixture
def empty_database_url(test_database_url: str) -> str:
    """The test database with every content table emptied."""
    assert make_url(test_database_url).database.endswith("_test")  # pyright: ignore[reportOptionalMemberAccess]
    execute(test_database_url, "TRUNCATE profile, stages, projects RESTART IDENTITY")
    return test_database_url


@pytest.fixture
def content_dir(tmp_path: Path) -> Path:
    """A scratch copy of the small fixture content, safe to edit."""
    target = tmp_path / "content"
    shutil.copytree(FIXTURE_CONTENT, target)
    return target
