"""Content routes: `/profile`, `/stages`, `/projects` and `/projects/{slug}`."""

from fastapi import APIRouter, HTTPException, status

from app.content.schema import Profile, Project
from app.deps import ContentServiceDep
from app.services.content import (
    ContentNotSeededError,
    ProjectNotFoundError,
    Stage,
)

router = APIRouter(tags=["content"])


@router.get("/profile")
async def get_profile(service: ContentServiceDep) -> Profile:
    """Return Ali's profile."""
    try:
        return await service.get_profile()
    except ContentNotSeededError:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Content has not been seeded."
        ) from None


@router.get("/stages")
async def list_stages(service: ContentServiceDep) -> list[Stage]:
    """Return the five Stages in Climb order."""
    return await service.list_stages()


@router.get("/projects")
async def list_projects(service: ContentServiceDep) -> list[Project]:
    """Return the Projects in the CV's order."""
    return await service.list_projects()


@router.get("/projects/{slug}")
async def get_project(slug: str, service: ContentServiceDep) -> Project:
    """Return one Project, or 404 if the slug is unknown."""
    try:
        return await service.get_project(slug)
    except ProjectNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found.") from None
