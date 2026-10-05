"""MinIO (S3) access: client factory and the readiness probe."""

import asyncio
from typing import TYPE_CHECKING

import boto3
from botocore.config import Config

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
