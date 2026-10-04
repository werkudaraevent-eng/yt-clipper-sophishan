"""Render a finished clip again with its owner's edit.

The source video is not kept once a project is done, so the clip's part of it
is downloaded again (a stream copy of a minute or two). Captions come from the
edit or the clip's stored words; only time a longer cut adds is transcribed.
"""

import logging
import subprocess
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import UUID

from ..options import ClipEdit, JobOptions, Timeframe
from . import pipeline
from .highlights import TEASER_SECONDS, Highlight, Highlighter
from .render import RenderSettings, describe, render_clip
from .transcript import Word, apply_terms, slice_words, spoken_end
from .translate import translate_words

log = logging.getLogger("clipper_worker.rerender")

# Video kept around the cut, so the render never runs off the downloaded part.
PAD_SECONDS = 1.0
# A cold open must start this far into the clip (see highlights._teaser_edges).
TEASER_LEAD_SECONDS = 3.0
# Sample rate for finding an old clip's cold open by its sound.
MATCH_RATE = 8000


@dataclass(frozen=True)
class ClipRow:
    """A finished clip as stored."""

    id: UUID
    position: int
    start: float
    end: float
    title: str
    hook_text: str
    description: str
    virality_score: int
    reason: str
    video_path: str | None
    words: list[Word]
    render: dict[str, Any] | None


@dataclass
class Rerendered:
    start: float
    end: float
    hook_text: str
    words: list[Word]
    render: dict[str, Any]  # see render.describe
    video_path: Path
    thumbnail_path: Path


def look_of(clip: ClipRow, options: JobOptions) -> dict[str, Any]:
    """How the clip looks now. Clips from before the editor have no record of
    it and were rendered with the project's options."""
    return {
        "template": options.captions.template,
        "position": options.captions.position,
        "wordsPerCaption": options.captions.words_per_caption,
        "layout": options.layout,
        "hookTitle": options.hook_title,
        "coldOpen": options.cold_open,
        "teaser": None,
        **(clip.render or {}),
    }


def rerender(
    options: JobOptions,
    clip: ClipRow,
    edit: ClipEdit,
    work: Path,
    report: pipeline.ProgressFn,
    *,
    fetch: Callable[[JobOptions, Path, pipeline.ProgressFn], pipeline.Source] = (
        pipeline.fetch_youtube
    ),
    current_video: Callable[[], Path | None] = lambda: None,
    terms: Sequence[tuple[str, str]] = (),
    highlighter: Highlighter | None = None,
) -> Rerendered:
    """`current_video` fetches the clip's file as it is now; it is only needed
    for clips from before the editor, to find their cold open."""
    work.mkdir(parents=True, exist_ok=True)
    look = look_of(clip, options)
    if edit.style is not None:
        look.update(edit.style.model_dump(by_alias=True, exclude_none=True))
    start = clip.start if edit.start is None else edit.start
    end = clip.end if edit.end is None else edit.end
    if end - start < 3:
        raise ValueError("a clip runs at least 3 seconds")

    recover = clip.render is None and look["coldOpen"]
    lo, hi = (min(start, clip.start), max(end, clip.end)) if recover else (start, end)
    section = options.model_copy(
        update={"timeframe": Timeframe(start=max(0.0, lo - PAD_SECONDS), end=hi + PAD_SECONDS)}
    )
    source = fetch(section, work, report)
    if recover:
        look["teaser"] = find_teaser(current_video(), source, clip)

    base = clip.words if edit.words is None else [Word(w.text, w.start, w.end) for w in edit.words]
    base = sorted(base, key=lambda w: w.start)
    words = _words_for(base, clip, start, end, source, options, terms, highlighter, report)

    teaser = tuple(look["teaser"]) if look["teaser"] else None
    plays = (
        look["coldOpen"]
        and teaser is not None
        and teaser[0] >= start + TEASER_LEAD_SECONDS
        and teaser[1] <= end + 0.01
    )
    hook = clip.hook_text if edit.hook is None else edit.hook.strip()
    settings = RenderSettings(
        layout=look["layout"],
        captions=options.captions.enabled,
        template=look["template"],
        position=look["position"],
        words_per_caption=look["wordsPerCaption"],
        hook_title=look["hookTitle"],
    )
    highlight = Highlight(
        start, end, clip.title, hook, clip.description, clip.virality_score, clip.reason,
        teaser if plays else None,
    )  # fmt: skip
    # Same file name as before, so the upload replaces the old files in place.
    name = Path(clip.video_path).stem if clip.video_path else f"clip-{clip.position + 1:02d}"
    report("render", 0.5)
    video, thumb = render_clip(source.path, source.offset, highlight, words, settings, work, name)
    report("render", 1.0)
    return Rerendered(
        start, end, hook, words, describe(settings, look["coldOpen"], teaser), video, thumb
    )


def _words_for(
    base: list[Word],
    clip: ClipRow,
    start: float,
    end: float,
    source: pipeline.Source,
    options: JobOptions,
    terms: Sequence[tuple[str, str]],
    highlighter: Highlighter | None,
    report: pipeline.ProgressFn,
) -> list[Word]:
    """The captions over [start, end]: the clip's own words where it already
    ran, and freshly transcribed ones where a longer cut adds time."""
    kept = slice_words(base, start, end)
    grows_left, grows_right = start < clip.start - 0.05, end > clip.end + 0.05
    if not (grows_left or grows_right):
        return kept

    if terms:
        source.vocabulary = pipeline.with_terms(source.vocabulary, terms)
    if source.transcribe or not source.words:
        try:
            pipeline.transcribe(source, options, report)
        except Exception:  # noqa: BLE001 - the added seconds just go without captions
            log.exception("could not transcribe the added part of the clip")
    heard = slice_words(apply_terms(source.words, terms), start, end)

    # Where the stored words stop; heard words past these are new.
    left = min(clip.start, kept[0].start - 0.15) if kept else clip.start
    right = max(clip.end, spoken_end(kept[-1])) if kept else clip.end
    before = [w for w in heard if grows_left and w.start < left]
    after = [w for w in heard if grows_right and w.start >= right - 0.02]

    target = pipeline._translation_target(options, source)
    if target and options.captions.enabled and (before or after):
        try:
            llm = highlighter or pipeline.default_highlighter(source, options)
            before = translate_words(llm, before, target, log=log.info) if before else before
            after = translate_words(llm, after, target, log=log.info) if after else after
        except Exception:  # noqa: BLE001 - untranslated beats missing
            log.exception("could not translate the added words; keeping them as heard")
    return before + kept + after


def find_teaser(
    current: Path | None, source: pipeline.Source, clip: ClipRow
) -> tuple[float, float] | None:
    """Where a clip rendered before the editor took its cold open from.

    Such a file opens with the teaser and then plays the whole clip, so it runs
    longer than the clip by the teaser's length. The teaser's sound is then
    looked up inside the clip's part of the video.
    """
    if current is None or not current.exists():
        return None
    extra = _duration(current) - (clip.end - clip.start)
    if extra < TEASER_SECONDS[0] - 0.3:
        return None
    needle = _pcm(current, 0.0, extra)
    hay = _pcm(source.path, clip.start - source.offset, clip.end - clip.start)
    at = best_match(needle, hay, MATCH_RATE)
    if at is None:
        log.warning("clip %s: cold open not found in the video", clip.id)
        return None
    return round(clip.start + at, 3), round(clip.start + at + extra, 3)


def best_match(needle, hay, rate: int, threshold: float = 0.5) -> float | None:
    """Seconds into `hay` where `needle` (both mono samples) sounds most alike,
    or None when nothing is close (normalized cross-correlation)."""
    import numpy as np

    needle = np.asarray(needle, dtype=np.float64)
    hay = np.asarray(hay, dtype=np.float64)
    n = len(needle)
    norm = np.linalg.norm(needle)
    if n == 0 or len(hay) < n or norm == 0:
        return None
    size = 1 << (len(hay) + n).bit_length()
    corr = np.fft.irfft(np.fft.rfft(hay, size) * np.conj(np.fft.rfft(needle, size)), size)
    corr = corr[: len(hay) - n + 1]
    sums = np.concatenate(([0.0], np.cumsum(hay**2)))
    energy = np.sqrt(np.maximum(sums[n:] - sums[:-n], 1e-12))
    score = corr / (energy * norm)
    k = int(np.argmax(score))
    return k / rate if score[k] >= threshold else None


def _duration(path: Path) -> float:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
         str(path)],
        capture_output=True, text=True,
    )  # fmt: skip
    try:
        return float(proc.stdout.strip())
    except ValueError:
        return 0.0


def _pcm(path: Path, start: float, duration: float):
    """Mono samples of [start, start + duration] of the file's audio."""
    import numpy as np

    proc = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-ss", f"{max(start, 0.0):.3f}",
         "-t", f"{duration:.3f}", "-i", str(path), "-vn", "-ac", "1", "-ar", str(MATCH_RATE),
         "-f", "f32le", "-"],
        capture_output=True,
    )  # fmt: skip
    if proc.returncode != 0:
        return np.zeros(0, dtype=np.float32)
    return np.frombuffer(proc.stdout, dtype=np.float32)
