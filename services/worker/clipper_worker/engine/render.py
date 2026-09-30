"""Cut, reframe, caption and encode one clip with a single FFmpeg pass."""

import os
import subprocess
from dataclasses import dataclass, replace
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
    cuts: tuple[float, ...] = ()
    if clip.teaser is not None:
        cuts = (clip.teaser[1] - clip.teaser[0],)
        source, clip, words = _join_cold_open(source, source_offset, clip, words, out_dir, name)
        source_offset = 0.0
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
        cuts=cuts,
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


def _has_audio(path: Path) -> bool:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
         "-of", "csv=p=0", str(path)],
        capture_output=True, text=True,
    )  # fmt: skip
    return bool(proc.stdout.strip())


def _join_cold_open(
    source: Path,
    source_offset: float,
    clip: Highlight,
    words: list[Word],
    out_dir: Path,
    name: str,
) -> tuple[Path, Highlight, list[Word]]:
    """Cut the teaser and then the whole clip into one file, and move the clip
    and its words onto that file's timeline, so the rest of the render (face
    tracking, captions, hook) treats it as one continuous clip."""
    assert clip.teaser is not None
    t_start, t_end = clip.teaser
    t_len, length = t_end - t_start, clip.end - clip.start
    inputs: list[str] = []
    for start, duration in ((t_start, t_len), (clip.start, length)):
        at = start - source_offset
        inputs += ["-ss", f"{at:.3f}", "-t", f"{duration:.3f}", "-i", str(source)]
    video = "".join(f"[{i}:v]fps=30,setpts=PTS-STARTPTS[v{i}];" for i in (0, 1))
    if _has_audio(source):
        # Short fades keep the hard cut between the two parts from clicking.
        fade_at = max(t_len - 0.06, 0.0)
        graph = (
            f"{video}[0:a]asetpts=PTS-STARTPTS,afade=t=out:st={fade_at:.3f}:d=0.06[a0];"
            "[1:a]asetpts=PTS-STARTPTS,afade=t=in:d=0.06[a1];"
            "[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]"
        )
        maps = ["-map", "[v]", "-map", "[a]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000"]
    else:
        graph = f"{video}[v0][v1]concat=n=2:v=1:a=0[v]"
        maps = ["-map", "[v]"]
    joined = out_dir / f"{name}.cold.mp4"
    _run(
        ["ffmpeg", "-y", "-nostdin", "-loglevel", "error", *inputs,
         "-filter_complex", graph, *maps,
         "-c:v", "libx264", "-preset", "ultrafast", "-crf", "14", "-pix_fmt", "yuv420p",
         str(joined)]
    )  # fmt: skip

    def shift(ws: list[Word], origin: float, lo: float, hi: float) -> list[Word]:
        return [
            Word(w.text, max(w.start - origin + lo, lo), min(w.end - origin + lo, hi)) for w in ws
        ]

    moved = shift(slice_words(words, t_start, t_end), t_start, 0.0, t_len)
    moved += shift(slice_words(words, clip.start, clip.end), clip.start, t_len, t_len + length)
    return joined, replace(clip, start=0.0, end=t_len + length, teaser=None), moved
