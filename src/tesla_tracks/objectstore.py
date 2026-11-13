"""Optional mirror of the Parquet files to S3-compatible storage (Cloudflare R2, AWS S3, MinIO...).

Local disk stays the working copy; the bucket is a durable copy that DuckDB can also query
directly (e.g. `SELECT * FROM 's3://bucket/tesla-tracks/derived/drives.parquet'`).

Enabled when S3_BUCKET is set. Env vars:
    S3_BUCKET, S3_PREFIX (default "tesla-tracks"), S3_ENDPOINT_URL (R2: https://<account>.r2.cloudflarestorage.com),
    S3_REGION (R2: "auto"), AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

log = logging.getLogger(__name__)


class Mirror:
    def __init__(self, data_dir: Path, bucket: str, prefix: str, endpoint_url: str | None, region: str):
        import boto3  # imported lazily: only needed when mirroring is enabled

        self.data_dir = data_dir
        self.bucket = bucket
        self.prefix = prefix.strip("/")
        self.client = boto3.client("s3", endpoint_url=endpoint_url or None, region_name=region)
        self.manifest_path = data_dir / "state" / "objectstore-manifest.json"
        self.manifest: dict[str, list[int]] = (
            json.loads(self.manifest_path.read_text()) if self.manifest_path.exists() else {}
        )

    @classmethod
    def from_env(cls, data_dir: Path) -> Mirror | None:
        bucket = os.environ.get("S3_BUCKET", "").strip()
        if not bucket:
            return None
        return cls(
            data_dir,
            bucket,
            os.environ.get("S3_PREFIX", "tesla-tracks"),
            os.environ.get("S3_ENDPOINT_URL", "").strip() or None,
            os.environ.get("S3_REGION", "auto"),
        )

    def _key(self, rel: str) -> str:
        return f"{self.prefix}/{rel}" if self.prefix else rel

    def sync(self) -> dict:
        """Upload new/changed Parquet files and delete remote copies of files removed locally."""
        local: dict[str, list[int]] = {}
        for sub in ("raw", "derived"):
            for path in (self.data_dir / sub).rglob("*.parquet"):
                if path.name.startswith("."):
                    continue
                st = path.stat()
                local[path.relative_to(self.data_dir).as_posix()] = [st.st_size, st.st_mtime_ns]
        uploaded = deleted = 0
        for rel, sig in sorted(local.items()):
            if self.manifest.get(rel) == sig:
                continue
            self.client.upload_file(str(self.data_dir / rel), self.bucket, self._key(rel))
            self.manifest[rel] = sig
            uploaded += 1
        for rel in sorted(set(self.manifest) - set(local)):
            self.client.delete_object(Bucket=self.bucket, Key=self._key(rel))
            del self.manifest[rel]
            deleted += 1
        if uploaded or deleted:
            tmp = self.manifest_path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.manifest))
            tmp.replace(self.manifest_path)
        return {"uploaded": uploaded, "deleted": deleted}
