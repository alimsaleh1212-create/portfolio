"""Health routes: `/api/v1/health/live` and `/api/v1/health/ready`."""

from typing import Literal

from fastapi import APIRouter, Response, status
from pydantic import BaseModel

from app.deps import HealthServiceDep
from app.services.health import ReadinessReport

router = APIRouter(prefix="/health", tags=["health"])


class LivenessResponse(BaseModel):
    """Body of the liveness endpoint."""

    status: Literal["ok"] = "ok"


@router.get("/live")
async def live() -> LivenessResponse:
    """Report that the process is up. Checks no dependencies."""
    return LivenessResponse()


@router.get(
    "/ready",
    responses={503: {"model": ReadinessReport, "description": "A dependency failed"}},
)
async def ready(response: Response, service: HealthServiceDep) -> ReadinessReport:
    """Report each dependency's status; 503 if any dependency fails."""
    report = await service.check_readiness()
    if report.status != "ok":
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return report
