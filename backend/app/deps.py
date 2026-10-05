"""Dependency-injection providers wiring the layers together."""

from typing import Annotated, cast

from fastapi import Depends, Request

from app.services.content import ContentService
from app.services.health import HealthService
from app.services.media import MediaService


def get_health_service(request: Request) -> HealthService:
    """Return the health service built at startup."""
    return cast(HealthService, request.app.state.health_service)


HealthServiceDep = Annotated[HealthService, Depends(get_health_service)]


def get_content_service(request: Request) -> ContentService:
    """Return the content service built at startup."""
    return cast(ContentService, request.app.state.content_service)


ContentServiceDep = Annotated[ContentService, Depends(get_content_service)]


def get_media_service(request: Request) -> MediaService:
    """Return the media service built at startup."""
    return cast(MediaService, request.app.state.media_service)


MediaServiceDep = Annotated[MediaService, Depends(get_media_service)]
