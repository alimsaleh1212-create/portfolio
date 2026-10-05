"""Dependency-injection providers wiring the layers together."""

from typing import Annotated, cast

from fastapi import Depends, Request

from app.services.health import HealthService


def get_health_service(request: Request) -> HealthService:
    """Return the health service built at startup."""
    return cast(HealthService, request.app.state.health_service)


HealthServiceDep = Annotated[HealthService, Depends(get_health_service)]
