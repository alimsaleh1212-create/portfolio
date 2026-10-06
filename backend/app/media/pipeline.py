"""Make the bucket and the media table match the source folder.

For each role: skip it when the source file is absent, leave it alone when the
file and the processing settings are unchanged, otherwise prepare, upload,
record and remove what the old version stored.
"""

import asyncio
from dataclasses import dataclass, field
from pathlib import Path

import structlog

from app.content.loader import ContentError
from app.data.media_repo import MediaRecord, MediaRepository
from app.data.storage import MediaStore
from app.media import prepare
from app.media.manifest import MediaManifest
from app.media.schema import ROLE_ORDER, MediaRole

logger = structlog.get_logger(__name__)


class MediaMissingError(ContentError):
    """Strict mode: a source file named in the manifest is not in the folder."""


@dataclass
class MediaReport:
    """What one run did. An unchanged run uploads and encodes nothing."""

    processed: list[str] = field(default_factory=list)
    unchanged: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    removed: list[str] = field(default_factory=list)
    objects_uploaded: int = 0
    objects_deleted: int = 0


@dataclass(frozen=True)
class _Entry:
    role: MediaRole
    file: str
    alt: str | None
    download_name: str | None
    label: str
    poster_seconds: float = 0.0
    in_content: bool = False
    """The file is in the content folder (tracked), not the media folder."""
    is_folder: bool = False
    """`file` is a folder of pictures (the stills)."""


def _entries(manifest: MediaManifest) -> list[_Entry]:
    by_role: dict[str, _Entry] = {
        "portrait": _Entry(
            "portrait", manifest.portrait.file, manifest.portrait.alt, None, "Portrait"
        ),
        "video_cv": _Entry(
            "video_cv",
            manifest.video_cv.file,
            manifest.video_cv.alt,
            None,
            "Video CV",
            manifest.video_cv.poster_seconds,
        ),
        "cv_pdf": _Entry(
            "cv_pdf",
            manifest.cv_pdf.file,
            None,
            manifest.cv_pdf.download_name,
            "CV PDF",
        ),
    }
    if manifest.hiker:
        by_role["hiker"] = _Entry(
            "hiker", manifest.hiker.file, None, None, "Hiker", in_content=True
        )
    if manifest.stills:
        by_role["stills"] = _Entry(
            "stills",
            manifest.stills.folder,
            None,
            None,
            "Stills",
            in_content=True,
            is_folder=True,
        )
    return [by_role[role] for role in ROLE_ORDER if role in by_role]


def find_missing(manifest: MediaManifest, source_dir: Path) -> list[str]:
    """Describe each manifest file that is not in the source folder."""
    return [
        f"{entry.label}: {entry.file} not found in {source_dir}"
        for entry in _entries(manifest)
        if not entry.in_content and not (source_dir / entry.file).is_file()
    ]


def require_all_present(manifest: MediaManifest, source_dir: Path) -> None:
    """Raise `MediaMissingError` naming every manifest file that is missing."""
    missing = find_missing(manifest, source_dir)
    if missing:
        listing = "\n".join(f"  {line}" for line in missing)
        raise MediaMissingError(f"{len(missing)} media file(s) missing:\n{listing}")


class MediaPipeline:
    """Syncs one source folder into MinIO and Postgres."""

    def __init__(
        self,
        store: MediaStore,
        repository: MediaRepository,
        source_dir: Path,
        content_dir: Path,
    ) -> None:
        """Store the bucket, the table and the folders to read from.

        `source_dir` holds the private media; `content_dir` holds the tracked
        files (the Hiker's model).
        """
        self._store = store
        self._repository = repository
        self._source_dir = source_dir
        self._content_dir = content_dir

    async def sync(
        self, manifest: MediaManifest, *, strict: bool = False
    ) -> MediaReport:
        """Bring storage and the table in line with the source folder.

        Args:
            manifest: Which file plays which role.
            strict: Fail, doing nothing, if any manifest file is missing.

        Returns:
            What was processed, left alone, skipped and removed.

        Raises:
            MediaMissingError: In strict mode, if a file is missing.
        """
        if strict:
            require_all_present(manifest, self._source_dir)
        await asyncio.to_thread(self._store.ensure_ready)
        report = MediaReport()
        for entry in _entries(manifest):
            await self._sync_role(entry, report)
        await self._sweep(report)
        logger.info(
            "media_seed_complete",
            processed=report.processed,
            unchanged=report.unchanged,
            skipped=report.skipped,
            removed=report.removed,
            objects_uploaded=report.objects_uploaded,
            objects_deleted=report.objects_deleted,
        )
        return report

    async def _sync_role(self, entry: _Entry, report: MediaReport) -> None:
        source = (self._content_dir if entry.in_content else self._source_dir) / (
            entry.file
        )
        existing = await self._repository.get(entry.role)
        present = source.is_dir() if entry.is_folder else source.is_file()
        if entry.in_content and not present:
            # A tracked file is part of the repository: its absence is a mistake.
            raise ContentError(f"{entry.label}: {entry.file} not found in content")
        if not present:
            logger.warning(
                "media_source_missing", role=entry.role, file=entry.file, skipped=True
            )
            report.skipped.append(entry.role)
            if existing:
                await self._repository.remove(entry.role)
                report.removed.append(entry.role)
            return
        source_hash = await asyncio.to_thread(
            prepare.stills_fingerprint if entry.is_folder else prepare.sha256_of_file,
            source,
        )
        fingerprint = prepare.settings_fingerprint(
            entry.role, entry.download_name or str(entry.poster_seconds)
        )
        if (
            existing
            and existing.source_sha256 == source_hash
            and existing.settings_hash == fingerprint
            and await self._objects_present(existing)
        ):
            await self._refresh_metadata(existing, entry)
            report.unchanged.append(entry.role)
            logger.info("media_unchanged", role=entry.role)
            return
        await self._process(entry, source, source_hash, fingerprint, existing, report)

    async def _objects_present(self, record: MediaRecord) -> bool:
        for variant in record.variants:
            if not await asyncio.to_thread(self._store.exists, variant.key):
                logger.warning("media_object_missing", key=variant.key)
                return False
        return True

    async def _refresh_metadata(self, record: MediaRecord, entry: _Entry) -> None:
        if record.alt != entry.alt or record.download_name != entry.download_name:
            await self._repository.upsert(
                MediaRecord(
                    role=record.role,
                    source_sha256=record.source_sha256,
                    settings_hash=record.settings_hash,
                    alt=entry.alt,
                    download_name=entry.download_name,
                    duration_seconds=record.duration_seconds,
                    variants=record.variants,
                )
            )

    async def _process(
        self,
        entry: _Entry,
        source: Path,
        source_hash: str,
        fingerprint: str,
        existing: MediaRecord | None,
        report: MediaReport,
    ) -> None:
        logger.info("media_processing", role=entry.role, file=entry.file)
        with prepare.scratch_dir() as folder:
            prepared = await asyncio.to_thread(self._prepare, entry, source, folder)
            for item in prepared.files:
                await asyncio.to_thread(
                    self._store.upload,
                    item.variant.key,
                    item.path,
                    item.variant.content_type,
                    item.content_disposition,
                )
                report.objects_uploaded += 1
        variants = [item.variant for item in prepared.files]
        await self._repository.upsert(
            MediaRecord(
                role=entry.role,
                source_sha256=source_hash,
                settings_hash=fingerprint,
                alt=entry.alt,
                download_name=entry.download_name,
                duration_seconds=prepared.duration_seconds,
                variants=variants,
            )
        )
        report.processed.append(entry.role)
        if existing:
            kept = {variant.key for variant in variants}
            old = [v.key for v in existing.variants if v.key not in kept]
            await asyncio.to_thread(self._store.delete, old)
            report.objects_deleted += len(old)

    @staticmethod
    def _prepare(entry: _Entry, source: Path, folder: Path) -> prepare.Prepared:
        if entry.role == "portrait":
            return prepare.prepare_portrait(source, folder)
        if entry.role == "video_cv":
            return prepare.prepare_video(source, folder, entry.poster_seconds)
        if entry.role == "hiker":
            return prepare.prepare_model(source)
        if entry.role == "stills":
            return prepare.prepare_stills(source, folder)
        return prepare.prepare_document(source, entry.download_name or source.name)

    async def _sweep(self, report: MediaReport) -> None:
        """Remove objects no row refers to (left by a crash or an older run)."""
        records = await self._repository.list_items()
        referenced = {variant.key for record in records for variant in record.variants}
        stored = await asyncio.to_thread(self._store.list_keys)
        stale = [key for key in stored if key not in referenced]
        if stale:
            await asyncio.to_thread(self._store.delete, stale)
            report.objects_deleted += len(stale)
