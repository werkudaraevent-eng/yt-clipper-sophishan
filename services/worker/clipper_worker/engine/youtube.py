"""YouTube access through yt-dlp: metadata, caption tracks, section download."""

import json
import os
import shutil
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .transcript import Word, parse_json3


@dataclass(frozen=True)
class VideoInfo:
    id: str
    title: str
    duration: float
    thumbnail: str | None
    language: str | None
    raw: dict[str, Any]


def _writable_cookies(path: str) -> str:
    """yt-dlp writes the cookie jar back on exit, so hand it a private copy.

    The original is usually mounted read-only into the container.
    """
    copy = Path(tempfile.gettempdir()) / "clipper-yt-cookies.txt"
    shutil.copyfile(path, copy)
    return str(copy)


def _base_opts() -> dict[str, Any]:
    opts: dict[str, Any] = {"quiet": True, "no_warnings": True, "noprogress": True}
    if cookies := os.environ.get("YTDLP_COOKIES_FILE"):
        opts["cookiefile"] = _writable_cookies(cookies)
    if proxy := os.environ.get("YTDLP_PROXY"):
        opts["proxy"] = proxy
    return opts


def fetch_info(url: str) -> VideoInfo:
    import yt_dlp

    with yt_dlp.YoutubeDL({**_base_opts(), "skip_download": True}) as ydl:
        info = ydl.extract_info(url, download=False)
    return VideoInfo(
        id=info["id"],
        title=info.get("title") or info["id"],
        duration=float(info.get("duration") or 0),
        thumbnail=info.get("thumbnail"),
        language=info.get("language"),
        raw=info,
    )


def pick_caption_track(info: dict[str, Any], language: str | None) -> tuple[str, str] | None:
    """(language, json3 url) of the best caption track, or None.

    Preference: manual subtitles in the requested language, then the original
    auto-generated track (`xx-orig`, word-timed), then any auto track in the
    language. With language "auto"/None the video's own language is used.
    """
    lang = None if language in (None, "auto") else language
    lang = lang or info.get("language")
    manual = info.get("subtitles") or {}
    auto = info.get("automatic_captions") or {}

    def json3(tracks: list[dict[str, Any]]) -> str | None:
        return next((t["url"] for t in tracks if t.get("ext") == "json3"), None)

    candidates: list[tuple[str, dict[str, Any]]] = []
    if lang:
        base = lang.split("-")[0]
        candidates += [(k, manual) for k in manual if k == lang or k.split("-")[0] == base]
        candidates += [(k, auto) for k in auto if k in (f"{base}-orig", f"{lang}-orig")]
        candidates += [(k, auto) for k in auto if k == lang or k == base]
    # Unknown language: the "-orig" auto track is always the spoken language.
    candidates += [(k, auto) for k in auto if k.endswith("-orig")]
    for key, pool in candidates:
        if url := json3(pool[key]):
            return key.removesuffix("-orig"), url
    return None


def download_caption_words(info: VideoInfo, language: str | None) -> tuple[str | None, list[Word]]:
    track = pick_caption_track(info.raw, language)
    if track is None:
        return None, []
    import yt_dlp

    lang, url = track
    with yt_dlp.YoutubeDL(_base_opts()) as ydl:
        data = json.loads(ydl.urlopen(url).read().decode("utf-8"))
    return lang, parse_json3(data)


def download_section(
    url: str,
    start: float,
    end: float,
    out_dir: Path,
    duration: float = 0,
    on_progress: Callable[[float], None] | None = None,
) -> Path:
    """Download [start, end] of the video as mp4 (H.264/AAC, up to 1080p).

    When the range covers the whole video the file is fetched as is: cutting a
    range makes ffmpeg re-encode it, which takes minutes and reports nothing.
    `on_progress` gets the downloaded fraction, 0..1.
    """
    import yt_dlp
    from yt_dlp.utils import download_range_func

    out_dir.mkdir(parents=True, exist_ok=True)
    opts: dict[str, Any] = {
        **_base_opts(),
        # >1080p on YouTube is VP9/AV1 only; prefer avc1 so the cut stays cheap.
        "format": (
            "bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b"
        ),
        "merge_output_format": "mp4",
        "outtmpl": str(out_dir / "source.%(ext)s"),
    }
    whole = start <= 0 and duration > 0 and end >= duration - 1
    if not whole:
        opts["download_ranges"] = download_range_func(None, [(start, end)])
        opts["force_keyframes_at_cuts"] = True
    if on_progress is not None:
        opts["progress_hooks"] = [_progress_hook(on_progress)]
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])
    matches = sorted(out_dir.glob("source.*"))
    if not matches:
        raise RuntimeError("yt-dlp finished without producing a file")
    return matches[0]


def _progress_hook(on_progress: Callable[[float], None]) -> Callable[[dict[str, Any]], None]:
    """Turn yt-dlp's per-file byte counts into one fraction for all files.

    Video and audio arrive as separate files, one after the other.
    """
    files: list[str] = []

    def hook(d: dict[str, Any]) -> None:
        if d.get("status") != "downloading":
            return
        name = d.get("filename") or ""
        if name not in files:
            files.append(name)
        total = d.get("total_bytes") or d.get("total_bytes_estimate")
        if not total:
            return
        count = max(len((d.get("info_dict") or {}).get("requested_formats") or []), 1)
        done = min(d.get("downloaded_bytes", 0) / total, 1.0)
        on_progress(min((files.index(name) + done) / count, 1.0))

    return hook
