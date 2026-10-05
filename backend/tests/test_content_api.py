"""Read endpoint tests: the API serves what the seed loaded."""

import asyncio
from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.seed import seed_content


@pytest.fixture
def seeded_client(
    make_client: Callable[..., TestClient], empty_database_url: str, content_dir: Path
) -> TestClient:
    asyncio.run(seed_content(content_dir, empty_database_url, strict=False))
    return make_client(database_url=empty_database_url)


def test_profile_returns_the_seeded_profile(seeded_client: TestClient) -> None:
    response = seeded_client.get("/api/v1/profile")

    body = response.json()
    assert response.status_code == 200
    assert body["name"] == "Test Person"
    assert body["links"]["email"] == "test@example.com"
    assert body["skills"] == [{"category": "Languages", "items": ["Python", "SQL"]}]
    assert body["experience"][0]["highlights"] == ["I tested things."]


def test_stages_come_in_climb_order_with_placeholder_flags(
    seeded_client: TestClient,
) -> None:
    response = seeded_client.get("/api/v1/stages")

    assert response.status_code == 200
    assert response.json() == [
        {
            "key": "trailhead",
            "name": "Trailhead",
            "period": "2016 – 2018",
            "body": "I studied.",
            "challenge": "Ali will write this Challenge.",
            "challenge_is_placeholder": True,
        },
        {
            "key": "ridge",
            "name": "Ridge",
            "period": None,
            "body": "I built projects.",
            "challenge": "A real challenge text.",
            "challenge_is_placeholder": False,
        },
    ]


def test_projects_come_in_the_content_order(seeded_client: TestClient) -> None:
    response = seeded_client.get("/api/v1/projects")

    assert response.status_code == 200
    assert [project["slug"] for project in response.json()] == ["alpha", "beta"]
    assert response.json()[0] == {
        "slug": "alpha",
        "name": "Alpha",
        "tagline": "First project",
        "description": "I built Alpha.",
        "stack": ["Python"],
        "metrics": ["95% recall"],
    }


def test_project_by_slug(seeded_client: TestClient) -> None:
    response = seeded_client.get("/api/v1/projects/beta")

    assert response.status_code == 200
    assert response.json()["name"] == "Beta"


def test_unknown_project_slug_returns_404(seeded_client: TestClient) -> None:
    response = seeded_client.get("/api/v1/projects/nope")

    assert response.status_code == 404


def test_unseeded_database_reports_unavailable_profile(
    make_client: Callable[..., TestClient], empty_database_url: str
) -> None:
    client = make_client(database_url=empty_database_url)

    assert client.get("/api/v1/profile").status_code == 503
    assert client.get("/api/v1/stages").json() == []
    assert client.get("/api/v1/projects").json() == []


def test_real_content_serves_five_stages_and_six_projects(
    make_client: Callable[..., TestClient], empty_database_url: str, settings: Settings
) -> None:
    asyncio.run(seed_content(settings.content_dir, empty_database_url, strict=False))
    client = make_client(database_url=empty_database_url)

    stages = client.get("/api/v1/stages").json()
    projects = client.get("/api/v1/projects").json()

    assert [stage["key"] for stage in stages] == [
        "trailhead",
        "long-approach",
        "steep-switch",
        "ridge",
        "high-camp",
    ]
    assert len(projects) == 6
    assert client.get("/api/v1/profile").status_code == 200
