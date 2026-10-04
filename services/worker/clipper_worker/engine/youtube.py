"""YouTube access through yt-dlp: metadata, caption tracks, section download."""

import json
import os
import shutil
import tempfile
import threading
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


# Seconds without data before a stalled connection is dropped (and retried by
# yt-dlp) instead of hanging the job until the queue reclaims it.
SOCKET_TIMEOUT = 30


def _base_opts() -> dict[str, Any]:
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "socket_timeout": SOCKET_TIMEOUT,
    }
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
    info: dict[str, Any] | None = None,
) -> Path:
    """Download [start, end] of the video as mp4 (H.264/AAC, up to 1080p).

    A range goes through ffmpeg as a stream copy: no re-encoding, so it is
    bound by the network, not the CPU. ffmpeg seeks to the keyframe before
    `start` and writes an edit list, so playback (ffmpeg, OpenCV) still starts
    exactly at `start`. ffmpeg tells yt-dlp nothing until it is done, so
    progress comes from watching the file grow against an estimated size
    (from the bitrates in `info`, the metadata from `fetch_info`).
    `on_progress` gets the downloaded fraction, 0..1.
    """
    import yt_dlp
    from yt_dlp.utils import download_range_func

    out_dir.mkdir(parents=True, exist_ok=True)
    opts: dict[str, Any] = {
        **_base_opts(),
        "format": FORMAT,
        "merge_output_format": "mp4",
        "outtmpl": str(out_dir / "source.%(ext)s"),
    }
    whole = start <= 0 and duration > 0 and end >= duration - 1
    watcher = None
    if not whole:
        opts["download_ranges"] = download_range_func(None, [(start, end)])
        # Abort a read that stalls instead of waiting forever (microseconds).
        timeout_us = str(SOCKET_TIMEOUT * 10**6)
        opts["external_downloader_args"] = {"ffmpeg_i": ["-rw_timeout", timeout_us]}
        expected = _expected_bytes(info, end - start) if info else None
        if on_progress is not None and expected:
            watcher = _SizeWatcher(out_dir, expected, on_progress)
    if on_progress is not None:
        opts["progress_hooks"] = [_progress_hook(on_progress)]
    with yt_dlp.YoutubeDL(opts) as ydl:
        if watcher:
            watcher.start()
        try:
            ydl.download([url])
        finally:
            if watcher:
                watcher.stop()
    matches = sorted(p for p in out_dir.glob("source.*") if p.suffix != ".part")
    if not matches:
        raise RuntimeError("yt-dlp finished without producing a file")
    return matches[0]


# >1080p on YouTube is VP9/AV1 only; prefer avc1 so the cut stays cheap.
FORMAT = "bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b"


def _expected_bytes(info: dict[str, Any], seconds: float) -> float | None:
    """Rough size of `seconds` of the formats FORMAT picks, from their bitrates."""
    formats = info.get("formats") or []

    def best(pred: Callable[[dict[str, Any]], bool], key: str) -> dict[str, Any] | None:
        pool = [f for f in formats if pred(f) and f.get("tbr")]
        return max(pool, key=lambda f: (f.get(key) or 0, f["tbr"]), default=None)

    def is_video(f: dict[str, Any]) -> bool:
        return (f.get("vcodec") or "none") != "none" and (f.get("height") or 0) <= 1080

    video = best(lambda f: is_video(f) and str(f.get("vcodec")).startswith("avc1"), "height")
    video = video or best(is_video, "height")
    audio = best(lambda f: (f.get("vcodec") or "none") == "none" and f.get("ext") == "m4a", "abr")
    kbps = sum(f["tbr"] for f in (video, audio) if f)
    return kbps * 1000 / 8 * seconds if kbps else None


class _SizeWatcher:
    """Report how far the partial file has grown, every couple of seconds."""

    def __init__(
        self, out_dir: Path, expected: float, on_progress: Callable[[float], None]
    ) -> None:
        self._out_dir = out_dir
        self._expected = expected
        self._on_progress = on_progress
        self._done = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._done.set()
        self._thread.join()

    def _run(self) -> None:
        while not self._done.wait(2.0):
            try:
                size = sum(p.stat().st_size for p in self._out_dir.glob("source.*"))
            except FileNotFoundError:  # renamed from .part between glob and stat
                continue
            if size:
                # The estimate is rough; leave room so the bar never hits 100% early.
                self._on_progress(min(size / self._expected, 0.95))


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
