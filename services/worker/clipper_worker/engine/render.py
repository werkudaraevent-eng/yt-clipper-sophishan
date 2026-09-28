"""Cut, reframe, caption and encode one clip with a single FFmpeg pass."""

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

from . import reframe
from .captions import write_ass
from .highlights import Highlight
from .transcript import Word, slice_words


@dataclass(frozen=True)
class RenderSettings:
    layout: str = "auto"
    captions: bool = True
    template: str = "karaoke"
    position: str = "bottom"
    words_per_caption: int = 3
    hook_title: bool = True


def _escape_filter_path(path: Path) -> str:
    # Inside a filtergraph, ':' and '\' and "'" need escaping.
    return str(path).replace("\\", "/").replace(":", r"\:").replace("'", r"\'")


def _run(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed ({proc.returncode}): {proc.stderr[-2000:]}")


def render_clip(
    source: Path,
    source_offset: float,
    clip: Highlight,
    words: list[Word],
    settings: RenderSettings,
    out_dir: Path,
    name: str,
) -> tuple[Path, Path]:
    """Render `clip` (absolute video times) from `source`, which starts at
    `source_offset` seconds into the video. Returns (mp4, jpg thumbnail)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    start = clip.start - source_offset
    duration = clip.end - clip.start

    if settings.layout == "auto":
        centers, src_w, src_h = reframe.face_track(source, start, start + duration)
        frame = reframe.tracking_filter(centers, src_w, src_h)
    else:
        frame = reframe.static_filter(settings.layout)

    graph = frame.filter
    if frame.sendcmd is not None:
        cmd_file = out_dir / f"{name}.cmd"
        cmd_file.write_text(frame.sendcmd or "")
        graph = graph.replace("{cmds}", _escape_filter_path(cmd_file))

    clip_words = [
        Word(w.text, w.start - clip.start, w.end - clip.start)
        for w in slice_words(words, clip.start, clip.end)
    ]
    ass = write_ass(
        out_dir / f"{name}.ass",
        words=clip_words,
        width=frame.width,
        height=frame.height,
        template=settings.template,
        position=settings.position,
        words_per_caption=settings.words_per_caption,
        hook_text=clip.hook_text if settings.hook_title else None,
        captions=settings.captions,
    )
    fonts_dir = os.environ.get("CLIPPER_FONTS_DIR", "/usr/share/fonts")
    graph = graph.replace(
        "[out]",
        f"[framed];[framed]ass='{_escape_filter_path(ass)}':"
        f"fontsdir='{_escape_filter_path(Path(fonts_dir))}'[out]",
    )
    graph = graph.replace("[in]", "[0:v]", 1)

    video = out_dir / f"{name}.mp4"
    _run(
        [
            "ffmpeg", "-y", "-nostdin", "-loglevel", "error",
            "-ss", f"{start:.3f}", "-t", f"{duration:.3f}", "-i", str(source),
            "-filter_complex", graph,
            "-map", "[out]", "-map", "0:a?",
            "-c:v", "libx264", "-preset", os.environ.get("CLIPPER_X264_PRESET", "veryfast"),
            "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30",
            "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
            "-movflags", "+faststart",
            str(video),
        ]
    )  # fmt: skip
    thumb = out_dir / f"{name}.jpg"
    _run(
        [
            "ffmpeg", "-y", "-nostdin", "-loglevel", "error",
            "-ss", f"{min(1.0, duration / 2):.2f}", "-i", str(video),
            "-frames:v", "1", "-q:v", "3", str(thumb),
        ]
    )  # fmt: skip
    return video, thumb
