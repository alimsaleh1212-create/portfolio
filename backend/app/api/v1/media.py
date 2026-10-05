"""Media route: `/media`."""

from fastapi import APIRouter

from app.deps import MediaServiceDep
from app.services.media import MediaItem

router = APIRouter(tags=["media"])


@router.get("/media")
async def list_media(service: MediaServiceDep) -> list[MediaItem]:
    """Describe the Portrait, Video CV and CV PDF that exist, with their files."""
    return await service.list_items()
