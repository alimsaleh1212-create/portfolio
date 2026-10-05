"""Application settings, read from environment variables only."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration.

    Every field maps to the upper-case environment variable of the same name.
    No `.env` file is read by the application; Compose injects the variables.
    """

    model_config = SettingsConfigDict(extra="ignore")

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


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings, built once on first use."""
    # pydantic-settings fills the required fields from the environment.
    return Settings()  # pyright: ignore[reportCallIssue]
