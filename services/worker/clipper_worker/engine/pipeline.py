"""End-to-end clip pipeline: source -> transcript -> highlights -> rendered clips."""

import json
import logging
import os
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
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
from .transcript import Word, load_words, slice_words, transcribe_with_whisper
from .translate import translate_words

log = logging.getLogger("clipper_worker.pipeline")

ProgressFn = Callable[[str, float], None]

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
    path = youtube.download_section(options.youtube_url, start, end, work)
    return Source(
        path=path,
        offset=start,
        words=slice_words(words, start, end),
        title=info.title,
        language=language or info.language,
        video_id=info.id,
        duration=info.duration,
        thumbnail=info.thumbnail,
    )


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
    if not source.words:
        log.info("no captions; transcribing with whisper")
        words = transcribe_with_whisper(
            source.path, options.video_language, os.environ.get("CLIPPER_WHISPER_MODEL", "small")
        )
        source.words = [Word(w.text, w.start + source.offset, w.end + source.offset) for w in words]
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
