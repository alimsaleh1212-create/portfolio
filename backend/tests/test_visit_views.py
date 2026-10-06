"""The views Grafana reads, and the Visit table's references."""

import uuid

import pytest
from sqlalchemy.exc import DBAPIError

from tests.db_helpers import execute, fetch_all
from tests.visit_helpers import seed_content_rows


@pytest.fixture
def database_url(test_database_url: str) -> str:
    seed_content_rows(test_database_url)
    return test_database_url


def add_visit(url: str, *events: str) -> uuid.UUID:
    """Insert a Visit with the given events: Stage keys or other event types."""
    visit_id = uuid.uuid4()
    execute(
        url,
        "INSERT INTO visits (id, started_at, device_class) "  # noqa: S608
        f"VALUES ('{visit_id}', now(), 'desktop')",
    )
    for item in events:
        if item in {"cv_downloaded", "contact_message_sent"}:
            columns, values = "type", f"'{item}'"
        else:
            columns, values = "type, stage_key", f"'stage_reached', '{item}'"
        execute(
            url,
            f"INSERT INTO visit_events (visit_id, {columns}, created_at) "  # noqa: S608
            f"VALUES ('{visit_id}', {values}, now())",
        )
    return visit_id


@pytest.fixture
def prepared(database_url: str) -> dict[str, uuid.UUID]:
    return {
        "none": add_visit(database_url),
        "trailhead": add_visit(database_url, "trailhead"),
        # Out of Climb order on purpose: the highest Stage wins, not the last.
        "ridge": add_visit(database_url, "ridge", "trailhead", "long-approach"),
        "camp": add_visit(
            database_url,
            "trailhead",
            "long-approach",
            "steep-switch",
            "ridge",
            "high-camp",
        ),
        "switch": add_visit(database_url, "trailhead", "steep-switch"),
        "cv_only": add_visit(database_url, "cv_downloaded"),
    }


def test_progress_is_the_highest_stage_reached(
    database_url: str, prepared: dict[str, uuid.UUID]
) -> None:
    got = {
        row["visit_id"]: row["progress_stage_key"]
        for row in fetch_all(database_url, "SELECT * FROM visit_progress")
    }

    assert got == {
        prepared["none"]: None,
        prepared["trailhead"]: "trailhead",
        prepared["ridge"]: "ridge",
        prepared["camp"]: "high-camp",
        prepared["switch"]: "steep-switch",
        prepared["cv_only"]: None,
    }


def test_the_progress_view_carries_the_stage_position(
    database_url: str, prepared: dict[str, uuid.UUID]
) -> None:
    [row] = fetch_all(
        database_url,
        f"SELECT * FROM visit_progress WHERE visit_id = '{prepared['camp']}'",  # noqa: S608
    )

    assert row["progress_stage_position"] == 4
    assert row["started_at"].tzinfo is not None


def test_visits_per_stage_is_a_funnel_in_climb_order(
    database_url: str, prepared: dict[str, uuid.UUID]
) -> None:
    got = fetch_all(database_url, "SELECT * FROM visits_per_stage")

    assert [(r["stage_key"], r["visits"]) for r in got] == [
        ("trailhead", 4),
        ("long-approach", 3),
        ("steep-switch", 3),
        ("ridge", 2),
        ("high-camp", 1),
    ]


def test_a_visit_counts_for_the_stages_below_its_progress_even_without_their_events(
    database_url: str,
) -> None:
    add_visit(database_url, "trailhead", "ridge")

    got = fetch_all(database_url, "SELECT stage_key, visits FROM visits_per_stage")

    assert [(r["stage_key"], r["visits"]) for r in got] == [
        ("trailhead", 1),
        ("long-approach", 1),
        ("steep-switch", 1),
        ("ridge", 1),
        ("high-camp", 0),
    ]


def test_the_funnel_never_grows_going_up_the_mountain(
    database_url: str, prepared: dict[str, uuid.UUID]
) -> None:
    add_visit(database_url, "high-camp")

    counts = [
        r["visits"]
        for r in fetch_all(database_url, "SELECT visits FROM visits_per_stage")
    ]

    assert counts == sorted(counts, reverse=True)


def test_visits_per_stage_lists_every_stage_when_there_are_no_visits(
    database_url: str,
) -> None:
    got = fetch_all(database_url, "SELECT stage_key, visits FROM visits_per_stage")

    assert [r["visits"] for r in got] == [0, 0, 0, 0, 0]
    assert len(got) == 5


def test_other_tables_can_reference_a_visit(
    database_url: str, prepared: dict[str, uuid.UUID]
) -> None:
    execute(
        database_url,
        "CREATE TABLE expedition_probe (id serial PRIMARY KEY, "
        "visit_id uuid NOT NULL REFERENCES visits (id))",
    )
    try:
        execute(
            database_url,
            f"INSERT INTO expedition_probe (visit_id) VALUES ('{prepared['camp']}')",  # noqa: S608
        )
        with pytest.raises(DBAPIError):
            execute(
                database_url,
                f"INSERT INTO expedition_probe (visit_id) VALUES ('{uuid.uuid4()}')",  # noqa: S608
            )
    finally:
        execute(database_url, "DROP TABLE expedition_probe")


def test_a_visit_and_its_events_have_time_zones_and_checks(
    database_url: str,
) -> None:
    columns = fetch_all(
        database_url,
        "SELECT table_name, column_name, data_type FROM information_schema.columns "
        "WHERE column_name IN ('started_at', 'created_at') "
        "AND table_name IN ('visits', 'visit_events')",
    )

    assert {c["data_type"] for c in columns} == {"timestamp with time zone"}
    assert len(columns) == 2
    with pytest.raises(DBAPIError):
        execute(
            database_url,
            "INSERT INTO visits (started_at, device_class) VALUES (now(), 'watch')",
        )
