"""Word-level transcripts: YouTube json3 captions, Whisper fallback, prompt text."""

import json
import re
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
    return [w for w in words if w.end > start and w.start < end]


def transcribe_with_whisper(media_path: Path, language: str | None, model_size: str) -> list[Word]:
    """Word timings from faster-whisper (optional `asr` extra)."""
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:  # pragma: no cover - depends on optional extra
        raise RuntimeError(
            "Video has no usable captions and faster-whisper is not installed "
            "(pip install 'clipper-worker[asr]')"
        ) from exc

    model = WhisperModel(model_size, device="auto", compute_type="auto")
    segments, _info = model.transcribe(
        str(media_path),
        language=None if language in (None, "auto") else language.split("-")[0],
        word_timestamps=True,
        vad_filter=True,
    )
    words: list[Word] = []
    for segment in segments:
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


def to_prompt_lines(words: list[Word], max_seconds: float = 8.0) -> str:
    """Transcript as `[m:ss] text` lines, split at sentence ends or every ~8s."""
    lines: list[str] = []
    buf: list[Word] = []
    for w in words:
        buf.append(w)
        if _SENTENCE_END.search(w.text) or w.end - buf[0].start >= max_seconds:
            lines.append(f"[{format_clock(buf[0].start)}] " + " ".join(x.text for x in buf))
            buf = []
    if buf:
        lines.append(f"[{format_clock(buf[0].start)}] " + " ".join(x.text for x in buf))
    return "\n".join(lines)


def save_words(words: list[Word], path: Path) -> None:
    path.write_text(json.dumps([asdict(w) for w in words], ensure_ascii=False))


def load_words(path: Path) -> list[Word]:
    return [Word(**w) for w in json.loads(path.read_text())]
