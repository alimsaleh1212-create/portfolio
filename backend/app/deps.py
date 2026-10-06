"""Dependency-injection providers wiring the layers together."""

from typing import Annotated, cast

from fastapi import Depends, Request

from app.services.clients import ClientInfo, parse_forwarded_address
from app.services.contact import ContactService
from app.services.content import ContentService
from app.services.health import HealthService
from app.services.media import MediaService
from app.services.visits import VisitService


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


def get_visit_service(request: Request) -> VisitService:
    """Return the Visit service built at startup."""
    return cast(VisitService, request.app.state.visit_service)


VisitServiceDep = Annotated[VisitService, Depends(get_visit_service)]


def get_contact_service(request: Request) -> ContactService:
    """Return the contact service built at startup."""
    return cast(ContactService, request.app.state.contact_service)


ContactServiceDep = Annotated[ContactService, Depends(get_contact_service)]


def get_client(request: Request) -> ClientInfo:
    """Build the in-memory client description for this request.

    The address is read from `X-Forwarded-For` straight off the request, not
    through a declared header parameter, so it can never be echoed into a
    validation error response or log.
    """
    forwarded = parse_forwarded_address(request.headers.get("x-forwarded-for"))
    # Without the proxy header (a direct call, as in tests) fall back to the peer.
    address = forwarded or (request.client.host if request.client else "")
    return ClientInfo(address, request.headers.get("user-agent", ""))


ClientDep = Annotated[ClientInfo, Depends(get_client)]
