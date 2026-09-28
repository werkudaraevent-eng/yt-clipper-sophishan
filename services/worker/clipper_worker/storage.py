"""Upload rendered clips to Supabase Storage (bucket `clips`).

Paths are `<user id>/<project id>/<file>`, which is what the storage policy in
supabase/migrations/20260928000000_clip_storage.sql lets the owner read.
Without SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (local dev) files stay on disk.
"""

import os
from pathlib import Path
from uuid import UUID

import httpx

BUCKET = "clips"
CONTENT_TYPES = {".mp4": "video/mp4", ".jpg": "image/jpeg"}


class ClipStorage:
    def __init__(self, url: str, service_key: str, client: httpx.Client | None = None) -> None:
        self.base = url.rstrip("/") + f"/storage/v1/object/{BUCKET}"
        self.client = client or httpx.Client(timeout=httpx.Timeout(30, write=600))
        self.headers = {"Authorization": f"Bearer {service_key}", "apikey": service_key}

    @classmethod
    def from_env(cls) -> "ClipStorage | None":
        url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        return cls(url, key) if url and key else None

    def upload(self, user_id: UUID, project_id: UUID, file: Path) -> str:
        path = f"{user_id}/{project_id}/{file.name}"
        with file.open("rb") as body:
            resp = self.client.post(
                f"{self.base}/{path}",
                headers={
                    **self.headers,
                    "Content-Type": CONTENT_TYPES.get(file.suffix, "application/octet-stream"),
                    "x-upsert": "true",
                    "Cache-Control": "max-age=31536000",
                },
                content=body,
            )
        if resp.status_code >= 300:
            raise RuntimeError(f"storage upload failed ({resp.status_code}): {resp.text[:300]}")
        return path
