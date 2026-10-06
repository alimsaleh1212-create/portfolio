"""Visit routes: `/visits` and `/visits/{id}/events`.

The client address is read from `X-Forwarded-For` straight off the request, not
through a declared header parameter, so it can never be echoed into a
validation error response or log.
"""

import uuid

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from app.deps import ClientDep, VisitServiceDep
from app.services.visits import (
    RATE_LIMIT_WINDOW_SECONDS,
    RateLimitedError,
    StartVisit,
    UnknownProjectError,
    VisitEvent,
    VisitExpiredError,
    VisitNotFoundError,
)

router = APIRouter(tags=["visits"])


class VisitStarted(BaseModel):
    """A started Visit."""

    id: uuid.UUID


def _too_many() -> HTTPException:
    return HTTPException(
        status_code=429,
        detail="Too many requests.",
        headers={"Retry-After": str(RATE_LIMIT_WINDOW_SECONDS)},
    )


@router.post(
    "/visits",
    status_code=201,
    response_model=VisitStarted,
    responses={204: {"description": "A known bot: no Visit is recorded."}},
)
async def start_visit(
    body: StartVisit, request: Request, service: VisitServiceDep, client: ClientDep
) -> VisitStarted | Response:
    """Start a Visit and return its ID. A known bot gets 204 and no ID."""
    try:
        visit_id = await service.start(body, client, request.headers.get("host"))
    except RateLimitedError:
        raise _too_many() from None
    if visit_id is None:
        return Response(status_code=204)
    return VisitStarted(id=visit_id)


@router.post("/visits/{visit_id}/events", status_code=204)
async def add_visit_event(
    visit_id: uuid.UUID,
    event: VisitEvent,
    service: VisitServiceDep,
    client: ClientDep,
) -> Response:
    """Add one event to a Visit. Repeating a Stage reached changes nothing."""
    try:
        await service.add_event(visit_id, event, client)
    except RateLimitedError:
        raise _too_many() from None
    except VisitNotFoundError:
        raise HTTPException(status_code=404, detail="No such Visit.") from None
    except VisitExpiredError:
        raise HTTPException(status_code=410, detail="This Visit has ended.") from None
    except UnknownProjectError:
        raise HTTPException(status_code=422, detail="Unknown Project.") from None
    return Response(status_code=204)
