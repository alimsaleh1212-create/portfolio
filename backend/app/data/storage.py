"""MinIO (S3) access: client factory and the readiness probe."""

import asyncio
import json
from collections.abc import Iterable
from pathlib import Path
from typing import TYPE_CHECKING

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client


def create_s3_client(
    endpoint: str, access_key: str, secret_key: str, timeout: float
) -> "S3Client":
    """Build a boto3 S3 client pointed at MinIO.

    Args:
        endpoint: MinIO URL, for example "http://minio:9000".
        access_key: MinIO access key.
        secret_key: MinIO secret key.
        timeout: Seconds for connect and read; retries are off so a down
            server fails fast.

    Returns:
        A configured S3 client.
    """
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="us-east-1",
        config=Config(
            connect_timeout=timeout,
            read_timeout=timeout,
            retries={"max_attempts": 1},
            s3={"addressing_style": "path"},
        ),
    )


class MinioProbe:
    """Readiness probe for MinIO: the media bucket must be reachable."""

    def __init__(self, client: "S3Client", bucket: str) -> None:
        """Store the client and bucket to probe."""
        self._client = client
        self._bucket = bucket

    async def ping(self) -> None:
        """Check the bucket exists; raises if MinIO cannot confirm it."""
        # boto3 is synchronous, so keep it off the event loop.
        await asyncio.to_thread(self._client.head_bucket, Bucket=self._bucket)


NOT_FOUND_CODES = {"404", "NoSuchKey", "NoSuchBucket", "NotFound"}
DELETE_BATCH = 1000


def _error_code(exc: ClientError) -> str:
    return exc.response.get("Error", {}).get("Code", "")


def public_read_policy(bucket: str) -> str:
    """Return a bucket policy letting anyone read objects and nothing else.

    There is no `s3:ListBucket`, so a visitor who knows a key can fetch it but
    cannot list the bucket, and nothing grants writes.
    """
    return json.dumps(
        {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Principal": {"AWS": ["*"]},
                    "Action": ["s3:GetObject"],
                    "Resource": [f"arn:aws:s3:::{bucket}/*"],
                }
            ],
        }
    )


class MediaStore:
    """The media bucket: public-read policy, uploads, checks and removals."""

    def __init__(self, client: "S3Client", bucket: str) -> None:
        """Store the client and bucket to work on."""
        self._client = client
        self._bucket = bucket

    def ensure_ready(self) -> None:
        """Create the bucket if it is missing and apply the public-read policy."""
        try:
            self._client.head_bucket(Bucket=self._bucket)
        except ClientError as exc:
            if _error_code(exc) not in NOT_FOUND_CODES:
                raise
            self._client.create_bucket(Bucket=self._bucket)
        self._client.put_bucket_policy(
            Bucket=self._bucket, Policy=public_read_policy(self._bucket)
        )

    def exists(self, key: str) -> bool:
        """Return whether an object with this key is stored."""
        try:
            self._client.head_object(Bucket=self._bucket, Key=key)
        except ClientError as exc:
            if _error_code(exc) in NOT_FOUND_CODES:
                return False
            raise
        return True

    def upload(
        self,
        key: str,
        path: Path,
        content_type: str,
        content_disposition: str | None = None,
    ) -> None:
        """Upload a file, replacing any object with the same key."""
        extra = {"ContentType": content_type}
        if content_disposition:
            extra["ContentDisposition"] = content_disposition
        self._client.upload_file(str(path), self._bucket, key, ExtraArgs=extra)

    def list_keys(self) -> list[str]:
        """Return every key in the bucket."""
        keys: list[str] = []
        paginator = self._client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self._bucket):
            keys.extend(item.get("Key", "") for item in page.get("Contents", []))
        return keys

    def delete(self, keys: Iterable[str]) -> None:
        """Delete objects; keys that are already gone are fine."""
        pending = list(keys)
        for start in range(0, len(pending), DELETE_BATCH):
            batch = pending[start : start + DELETE_BATCH]
            self._client.delete_objects(
                Bucket=self._bucket,
                Delete={"Objects": [{"Key": key} for key in batch], "Quiet": True},
            )
