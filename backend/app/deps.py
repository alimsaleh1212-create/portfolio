"""Dependency-injection providers wiring the layers together."""

from typing import Annotated, cast

from fastapi import Depends, Request

from app.services.content import ContentService
from app.services.health import HealthService


def get_health_service(request: Request) -> HealthService:
    """Return the health service built at startup."""
    return cast(HealthService, request.app.state.health_service)


HealthServiceDep = Annotated[HealthService, Depends(get_health_service)]


def get_content_service(request: Request) -> ContentService:
    """Return the content service built at startup."""
    return cast(ContentService, request.app.state.content_service)


ContentServiceDep = Annotated[ContentService, Depends(get_content_service)]
