"""Application settings, read from environment variables only."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration.

    Every field maps to the upper-case environment variable of the same name.
    No `.env` file is read by the application; Compose injects the variables.
    """

    model_config = SettingsConfigDict(extra="ignore", env_ignore_empty=True)

    database_url: str
    redis_url: str
    minio_endpoint: str
    minio_access_key: str
    minio_secret_key: str
    minio_bucket: str = "portfolio-media"
    health_check_timeout_seconds: float = 2.0
    log_level: str = "INFO"
    # Folder holding profile.yaml, stages.yaml and projects.yaml.
    content_dir: Path = Path("/content")
    # Folder holding the source photograph, video and PDF, mounted read-only.
    media_source_dir: Path = Path("/media-source")
    # A Visit accepts events for this long after it starts.
    visit_max_age_hours: int = 24
    # Requests per client per minute; beyond them the API answers 429.
    visit_start_limit_per_minute: int = 20
    visit_event_limit_per_minute: int = 120
    # Contact messages accepted per client per hour; beyond them the API answers 429.
    contact_limit_per_hour: int = 3
    # Mail delivery of contact messages. Delivery is on only when the server,
    # sender and recipient are all set; otherwise messages are stored only.
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    # "starttls" (upgrade a plain connection), "tls" (encrypted from the start)
    # or "none" (plain text, for a catcher on a private network only).
    smtp_security: Literal["starttls", "tls", "none"] = "starttls"
    mail_sender: str | None = None
    mail_recipient: str | None = None
    smtp_timeout_seconds: float = 10.0


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings, built once on first use."""
    # pydantic-settings fills the required fields from the environment.
    return Settings()  # pyright: ignore[reportCallIssue]
