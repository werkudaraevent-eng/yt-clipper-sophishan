"""Word-level transcripts: YouTube json3 captions, Whisper fallback, prompt text."""

import json
import re
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class Word:
    text: str
    start: float
    end: float


def parse_json3(data: dict) -> list[Word]:
    """Words with timings from a YouTube json3 caption track.

    Auto-generated tracks carry one segment per word (with `tOffsetMs`), so
    timing is exact. Manual tracks carry one segment per cue; their words are
    spread evenly across the cue.
    """
    words: list[Word] = []
    for event in data.get("events", []):
        segs = event.get("segs")
        if not segs or "tStartMs" not in event:
            continue
        ev_start = event["tStartMs"] / 1000
        ev_end = ev_start + event.get("dDurationMs", 0) / 1000
        timed = [
            (ev_start + s.get("tOffsetMs", 0) / 1000, s.get("utf8", ""))
            for s in segs
            if s.get("utf8", "").strip()
        ]
        if not timed:
            continue
        if len(timed) == 1 and len(timed[0][1].split()) > 1:
            tokens = timed[0][1].split()
            step = max(ev_end - ev_start, 0.2 * len(tokens)) / len(tokens)
            timed = [(ev_start + i * step, t) for i, t in enumerate(tokens)]
        for i, (start, text) in enumerate(timed):
            end = timed[i + 1][0] if i + 1 < len(timed) else ev_end
            for token in text.split():
                words.append(Word(token, round(start, 3), round(max(end, start + 0.05), 3)))

    words.sort(key=lambda w: w.start)
    # Cue windows overlap on auto tracks; clamp each word to the next start.
    fixed: list[Word] = []
    for i, w in enumerate(words):
        nxt = words[i + 1].start if i + 1 < len(words) else w.end
        end = min(w.end, nxt) if nxt > w.start else w.end
        fixed.append(Word(w.text, w.start, round(max(end, w.start + 0.05), 3)))
    return _dedupe(fixed)


def _dedupe(words: list[Word]) -> list[Word]:
    out: list[Word] = []
    for w in words:
        if out and out[-1].text == w.text and abs(out[-1].start - w.start) < 0.01:
            continue
        out.append(w)
    return out


def slice_words(words: list[Word], start: float, end: float) -> list[Word]:
    """Words heard between `start` and `end`.

    A clip usually starts just after a word whose caption time runs on through
    the silence before the next one; judging by its spoken end keeps that word
    (the tail of the previous sentence) out of the clip's first captions.
    """
    return [w for w in words if spoken_end(w) > start and w.start < end]


def transcribe_with_whisper(
    media_path: Path,
    language: str | None,
    model_size: str,
    on_progress: Callable[[float], None] | None = None,
) -> list[Word]:
    """Word timings from faster-whisper (optional `asr` extra).

    `on_progress` gets the transcribed fraction of the audio, 0..1.
    """
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:  # pragma: no cover - depends on optional extra
        raise RuntimeError(
            "Video has no usable captions and faster-whisper is not installed "
            "(pip install 'clipper-worker[asr]')"
        ) from exc

    model = WhisperModel(model_size, device="auto", compute_type="auto")
    segments, info = model.transcribe(
        str(media_path),
        language=None if language in (None, "auto") else language.split("-")[0],
        word_timestamps=True,
        vad_filter=True,
    )
    words: list[Word] = []
    for segment in segments:
        if on_progress is not None and info.duration:
            on_progress(min(segment.end / info.duration, 1.0))
        for w in segment.words or []:
            text = w.word.strip()
            if text:
                words.append(Word(text, round(w.start, 3), round(w.end, 3)))
    return words


def format_clock(seconds: float) -> str:
    seconds = max(0, int(seconds))
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


_SENTENCE_END = re.compile(r"[.!?…]$")
# Silence after a word long enough to count as a breath between phrases.
PAUSE_SECONDS = 0.45


def spoken_end(w: Word) -> float:
    """When the word's sound likely stops.

    Auto-caption words run until the next word starts, silence included, so
    their `end` says nothing about pauses. Estimate from the word's length.
    """
    return w.start + min(w.end - w.start, 0.2 + 0.07 * len(w.text))


def pause_after(words: list[Word], i: int) -> float:
    if i + 1 >= len(words):
        return float("inf")
    return words[i + 1].start - spoken_end(words[i])


@dataclass(frozen=True)
class Line:
    """Indices of the first and last word of one transcript line."""

    first: int
    last: int


def split_lines(words: list[Word], max_seconds: float = 8.0) -> list[Line]:
    """Break the transcript where the speaker breaks: sentence ends and pauses.

    Auto captions have no punctuation, so pauses carry most of it. A line that
    runs past `max_seconds` without either is split at its longest pause.
    """
    lines: list[Line] = []
    first = 0
    for i, w in enumerate(words):
        if _SENTENCE_END.search(w.text) or pause_after(words, i) >= PAUSE_SECONDS:
            lines.append(Line(first, i))
            first = i + 1
        elif w.end - words[first].start >= max_seconds:
            # Longest pause at least two seconds in; ties go to the later word.
            cands = [j for j in range(first, i) if words[j].end - words[first].start >= 2.0]
            cut = max(cands or [i], key=lambda j: (pause_after(words, j), j))
            lines.append(Line(first, cut))
            first = cut + 1
    if first < len(words):
        lines.append(Line(first, len(words) - 1))
    return lines


def to_prompt_lines(words: list[Word], max_seconds: float = 8.0) -> str:
    """Transcript as `[m:ss] text` lines, one per phrase (see `split_lines`)."""
    return "\n".join(
        f"[{format_clock(words[ln.first].start)}] "
        + " ".join(w.text for w in words[ln.first : ln.last + 1])
        for ln in split_lines(words, max_seconds)
    )


def clip_edges(words: list[Word], first: int, last: int) -> tuple[float, float]:
    """Cut points for words[first..last]: a little air around the speech,
    never reaching into the neighbouring words."""
    start = words[first].start - 0.25
    if first > 0:
        start = max(start, min(spoken_end(words[first - 1]) + 0.05, words[first].start))
    end = spoken_end(words[last]) + 0.5
    if last + 1 < len(words):
        end = min(end, words[last + 1].start - 0.08)
    return max(0.0, start), max(end, words[last].start + 0.3)


def save_words(words: list[Word], path: Path) -> None:
    path.write_text(json.dumps([asdict(w) for w in words], ensure_ascii=False))


def load_words(path: Path) -> list[Word]:
    return [Word(**w) for w in json.loads(path.read_text())]
