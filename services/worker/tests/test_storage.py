from uuid import uuid4

import httpx

from clipper_worker.storage import ClipStorage


def test_upload_posts_to_owner_folder(tmp_path):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["headers"] = request.headers
        seen["body"] = request.content
        return httpx.Response(200, json={"Key": "x"})

    f = tmp_path / "clip-01.mp4"
    f.write_bytes(b"video")
    storage = ClipStorage(
        "https://sb.example/", "svc", httpx.Client(transport=httpx.MockTransport(handler))
    )
    user, project = uuid4(), uuid4()
    path = storage.upload(user, project, f)
    assert path == f"{user}/{project}/clip-01.mp4"
    assert seen["url"] == f"https://sb.example/storage/v1/object/clips/{path}"
    assert seen["headers"]["content-type"] == "video/mp4"
    assert seen["headers"]["x-upsert"] == "true"
    assert seen["body"] == b"video"
