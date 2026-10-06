"""Media route: `/media`."""

from fastapi import APIRouter, Request, Response

from app.api.v1.http_cache import conditional_json
from app.deps import MediaServiceDep
from app.services.media import MediaItem

router = APIRouter(tags=["media"])


@router.get("/media", response_model=list[MediaItem])
async def list_media(request: Request, service: MediaServiceDep) -> Response:
    """Describe the Portrait, Video CV and CV PDF that exist, with their files."""
    return conditional_json(request, await service.list_items())
