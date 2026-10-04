"""End-to-end clip pipeline: source -> transcript -> highlights -> rendered clips."""

import json
import logging
import os
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass, field, replace
from pathlib import Path

from ..options import JobOptions
from . import youtube
from .highlights import (
    ClaudeHighlighter,
    DensityHighlighter,
    Highlight,
    Highlighter,
    find_highlights,
)
from .render import RenderSettings, render_clip
from .transcript import Word, load_words, slice_words, transcribe_audio
from .translate import translate_words

log = logging.getLogger("clipper_worker.pipeline")

ProgressFn = Callable[[str, float], None]


def stage_reporter(
    report: ProgressFn, stage: str, lo: float, hi: float, every: float = 2.0
) -> Callable[[float], None]:
    """Map a 0..1 fraction of one stage onto [lo, hi] of the whole job.

    Reports at most once per `every` seconds; each report is a database write.
    """
    last = 0.0

    def on_progress(fraction: float) -> None:
        nonlocal last
        now = time.monotonic()
        if now - last < every and fraction < 1.0:
            return
        last = now
        report(stage, lo + (hi - lo) * max(0.0, min(fraction, 1.0)))

    return on_progress


LANGUAGE_NAMES = {
    "en": "English", "id": "Indonesian", "ms": "Malay", "es": "Spanish", "pt": "Portuguese",
    "fr": "French", "de": "German", "it": "Italian", "nl": "Dutch", "ru": "Russian",
    "tr": "Turkish", "ar": "Arabic", "hi": "Hindi", "ja": "Japanese", "ko": "Korean",
    "zh": "Chinese", "th": "Thai", "vi": "Vietnamese", "tl": "Filipino", "pl": "Polish",
}  # fmt: skip


@dataclass
class Source:
    """A downloaded (or local) video section plus its word timings."""

    path: Path
    offset: float  # seconds into the original video where `path` starts
    words: list[Word]  # absolute times
    title: str
    language: str | None
    video_id: str | None = None
    duration: float | None = None
    thumbnail: str | None = None
    # Transcribe the audio even though `words` (YouTube captions) exist; the
    # captions are kept as a fallback.
    transcribe: bool = False


@dataclass
class RenderedClip:
    position: int
    highlight: Highlight
    video_path: Path
    thumbnail_path: Path
    words: list[Word] = field(default_factory=list)


@dataclass
class PipelineResult:
    source: Source
    clips: list[RenderedClip]

    def manifest(self) -> dict:
        return {
            "video": {
                "id": self.source.video_id,
                "title": self.source.title,
                "duration": self.source.duration,
                "language": self.source.language,
            },
            "clips": [
                {
                    "position": c.position,
                    **asdict(c.highlight),
                    "video": c.video_path.name,
                    "thumbnail": c.thumbnail_path.name,
                }
                for c in self.clips
            ],
        }


def fetch_youtube(options: JobOptions, work: Path, report: ProgressFn) -> Source:
    report("download", 0.02)
    info = youtube.fetch_info(options.youtube_url)
    start = options.timeframe.start
    end = min(options.timeframe.end, info.duration) if info.duration else options.timeframe.end
    if end <= start:
        raise RuntimeError(f"Timeframe starts after the video ends ({info.duration:.0f}s)")

    language, words = youtube.download_caption_words(info, options.video_language)
    log.info("captions: %s words (%s)", len(words), language)
    path = youtube.download_section(
        options.youtube_url,
        start,
        end,
        work,
        duration=info.duration,
        on_progress=stage_reporter(report, "download", 0.03, 0.24),
        info=info.raw,
    )
    return Source(
        path=path,
        offset=start,
        words=slice_words(words, start, end),
        title=info.title,
        language=language or info.language,
        video_id=info.id,
        duration=info.duration,
        thumbnail=info.thumbnail,
        transcribe=transcriber() == "whisper",
    )


def transcriber() -> str:
    """ "whisper" (default): word timings from the audio. "youtube": the video's
    own caption track when it has one, which is faster but often lags the
    speech and garbles talk that mixes languages."""
    return os.environ.get("CLIPPER_TRANSCRIBER", "whisper")


def transcribe(source: Source, options: JobOptions, report: ProgressFn) -> None:
    """Replace `source.words` with Whisper's, keeping the captions on failure."""
    # The language the user picked, else the one YouTube's captions are in.
    # Naming it beats Whisper's guess, which mistakes Indonesian for Malay;
    # English phrases inside the talk still come out in English.
    hint = options.video_language
    if hint in (None, "auto"):
        hint = source.language
    log.info("transcribing with whisper (%s)", hint or "language unknown")
    try:
        language, words = transcribe_audio(
            source.path,
            hint,
            os.environ.get("CLIPPER_WHISPER_MODEL", "large-v3-turbo"),
            on_progress=stage_reporter(report, "transcribe", 0.25, 0.39),
        )
    except Exception:
        if not source.words:
            raise
        log.exception("whisper failed; using the YouTube captions")
        return
    if not words and source.words:
        log.warning("whisper heard no words; using the YouTube captions")
        return
    source.words = [Word(w.text, w.start + source.offset, w.end + source.offset) for w in words]
    source.language = language or source.language


def default_highlighter(source: Source, options: JobOptions) -> Highlighter:
    if os.environ.get("CLIPPER_LLM_BASE_URL") or os.environ.get("ANTHROPIC_API_KEY"):
        return ClaudeHighlighter()
    if os.environ.get("CLIPPER_ALLOW_OFFLINE_HIGHLIGHTS") == "1":
        log.warning("No Anthropic credentials: using offline density highlights")
        return DensityHighlighter(source.words, options.clip_length_range)
    raise RuntimeError("Set ANTHROPIC_API_KEY, or CLIPPER_LLM_BASE_URL for a gateway")


def run(
    options: JobOptions,
    report: ProgressFn,
    work: Path,
    *,
    source: Source | None = None,
    highlighter: Highlighter | None = None,
) -> PipelineResult:
    work.mkdir(parents=True, exist_ok=True)
    if source is None:
        source = fetch_youtube(options, work, report)

    report("transcribe", 0.25)
    if not source.words or source.transcribe:
        transcribe(source, options, report)
    if not source.words:
        raise RuntimeError("No speech found in the selected timeframe")

    report("analyze", 0.4)
    window = (
        max(source.offset, options.timeframe.start),
        min(options.timeframe.end, max(w.end for w in source.words)),
    )
    target = options.caption_translation or source.language or options.video_language
    output_language = LANGUAGE_NAMES.get(
        (target or "").split("-")[0], "the same language as the transcript"
    )
    highlighter = highlighter or default_highlighter(source, options)
    highlights = find_highlights(
        highlighter,
        source.words,
        title=source.title,
        window=window,
        length_range=options.clip_length_range,
        output_language=output_language,
        direction=options.ai_direction,
        log=log.info,
    )

    if not options.cold_open:
        highlights = [replace(h, teaser=None) for h in highlights]

    settings = RenderSettings(
        layout=options.layout,
        captions=options.captions.enabled,
        template=options.captions.template,
        position=options.captions.position,
        words_per_caption=options.captions.words_per_caption,
        hook_title=options.hook_title,
    )
    translate_to = _translation_target(options, source)
    if translate_to and not hasattr(highlighter, "structured"):
        log.warning("caption translation needs an LLM; keeping original captions")
        translate_to = None

    clips: list[RenderedClip] = []
    for i, h in enumerate(highlights):
        report("render", 0.5 + 0.5 * i / len(highlights))
        words = slice_words(source.words, h.start, h.end)
        if translate_to and options.captions.enabled:
            words = translate_words(highlighter, words, translate_to, log=log.info)
        video, thumb = render_clip(
            source.path, source.offset, h, words, settings, work, f"clip-{i + 1:02d}"
        )
        clips.append(RenderedClip(i, h, video, thumb, words))
    report("render", 1.0)

    result = PipelineResult(source, clips)
    (work / "manifest.json").write_text(json.dumps(result.manifest(), ensure_ascii=False, indent=2))
    return result


def _translation_target(options: JobOptions, source: Source) -> str | None:
    """Display name of the caption language, or None when no translation is needed."""
    target = (options.caption_translation or "").split("-")[0]
    spoken = (source.language or options.video_language or "").split("-")[0]
    if not target or target == spoken:
        return None
    return LANGUAGE_NAMES.get(target, target)


def local_source(video: Path, words_file: Path, title: str, language: str | None) -> Source:
    """A source from files on disk, for the CLI and tests."""
    return Source(path=video, offset=0.0, words=load_words(words_file), title=title,
                  language=language)  # fmt: skip
