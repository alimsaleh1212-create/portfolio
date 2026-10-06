"""Media service: each prepared item described for the API."""

from pydantic import BaseModel, TypeAdapter

from app.data.media_repo import MediaRepository
from app.data.response_cache import ResponseCache
from app.media.schema import ROLE_ORDER, MediaRole, VariantKind

MEDIA_URL_PREFIX = "/media/"


class MediaVariant(BaseModel):
    """One file of a media item, with the address Caddy serves it at."""

    kind: VariantKind
    format: str
    """avif, webp, jpeg, h264, pdf or glb."""
    content_type: str
    url: str
    size_bytes: int
    width: int | None
    height: int | None


class MediaItem(BaseModel):
    """One media item: the Portrait, the Video CV, the CV PDF or the Hiker's model."""

    role: MediaRole
    alt: str | None
    """Alternative text for the Portrait; the label for the Video CV."""
    download_name: str | None
    """The file name a download is saved under (CV PDF only)."""
    duration_seconds: float | None
    """Length of the Video CV."""
    variants: list[MediaVariant]


MEDIA_JSON = TypeAdapter(list[MediaItem])


class MediaService:
    """Serves the prepared media."""

    def __init__(self, repository: MediaRepository, cache: ResponseCache) -> None:
        """Store the repository to read from and the cache in front of it."""
        self._repository = repository
        self._cache = cache

    async def list_items(self) -> bytes:
        """Return the items that exist, as a JSON body in a fixed role order.

        A role whose source file was never supplied is absent from the list.
        """

        async def load() -> bytes:
            return MEDIA_JSON.dump_json(await self._items())

        return await self._cache.get_or_load("media", "media", load)

    async def _items(self) -> list[MediaItem]:
        records = {
            record.role: record for record in await self._repository.list_items()
        }
        return [
            MediaItem(
                role=role,
                alt=record.alt,
                download_name=record.download_name,
                duration_seconds=record.duration_seconds,
                variants=[
                    MediaVariant(
                        kind=variant.kind,
                        format=variant.format,
                        content_type=variant.content_type,
                        url=f"{MEDIA_URL_PREFIX}{variant.key}",
                        size_bytes=variant.size_bytes,
                        width=variant.width,
                        height=variant.height,
                    )
                    for variant in record.variants
                ],
            )
            for role in ROLE_ORDER
            if (record := records.get(role))
        ]
