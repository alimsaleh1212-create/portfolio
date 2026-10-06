"""Content routes: `/profile`, `/stages`, `/projects` and `/projects/{slug}`.

Each returns the cached JSON body with an `ETag`, or 304 for a client that has it.
"""

from fastapi import APIRouter, HTTPException, Request, Response, status

from app.api.v1.http_cache import conditional_json
from app.content.schema import Profile, Project
from app.deps import ContentServiceDep
from app.services.content import (
    ContentNotSeededError,
    ProjectNotFoundError,
    Stage,
)

router = APIRouter(tags=["content"])


@router.get("/profile", response_model=Profile)
async def get_profile(request: Request, service: ContentServiceDep) -> Response:
    """Return Ali's profile."""
    try:
        return conditional_json(request, await service.get_profile())
    except ContentNotSeededError:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Content has not been seeded."
        ) from None


@router.get("/stages", response_model=list[Stage])
async def list_stages(request: Request, service: ContentServiceDep) -> Response:
    """Return the five Stages in Climb order."""
    return conditional_json(request, await service.list_stages())


@router.get("/projects", response_model=list[Project])
async def list_projects(request: Request, service: ContentServiceDep) -> Response:
    """Return the Projects in the CV's order."""
    return conditional_json(request, await service.list_projects())


@router.get("/projects/{slug}", response_model=Project)
async def get_project(
    slug: str, request: Request, service: ContentServiceDep
) -> Response:
    """Return one Project, or 404 if the slug is unknown."""
    try:
        return conditional_json(request, await service.get_project(slug))
    except ProjectNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found.") from None
