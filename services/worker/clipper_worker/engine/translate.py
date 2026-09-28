"""Caption translation that keeps word-level timing.

The transcript is cut into short segments (a sentence, or a pause-delimited
phrase). The LLM translates each segment as a whole, so grammar and word order
follow the target language, and the translated words are then spread over the
segment's original time span in proportion to their length. Captions stay in
sync with the speech at segment level, which is what viewers notice.
"""

from collections.abc import Callable
from typing import Protocol, TypeVar

from pydantic import BaseModel, Field

from .transcript import Word

M = TypeVar("M", bound=BaseModel)

SENTENCE_END = (".", "?", "!", "。", "？", "！")
MAX_SEGMENT_WORDS = 14
MAX_GAP = 0.8

SYSTEM_PROMPT = """You translate short-form video captions.

Each input segment is a spoken phrase. Translate every segment into {language}
so it reads naturally as an on-screen caption: keep the meaning and tone, keep
slang casual, keep names and brand names as they are, and do not add
explanations. Keep each translation about as long as the original, because it
has to fit the same few seconds on screen. Return every segment id exactly once."""


class TranslatedSegment(BaseModel):
    id: int
    text: str = Field(description="The segment translated into the target language")


class TranslatedSegments(BaseModel):
    segments: list[TranslatedSegment]


class StructuredLLM(Protocol):
    def structured(self, system: str, prompt: str, schema: type[M]) -> M: ...


def segment_words(words: list[Word]) -> list[list[Word]]:
    """Split words into phrases at sentence ends, pauses, or a length cap."""
    segments: list[list[Word]] = []
    current: list[Word] = []
    for w in words:
        if current and (w.start - current[-1].end > MAX_GAP or len(current) >= MAX_SEGMENT_WORDS):
            segments.append(current)
            current = []
        current.append(w)
        if w.text.endswith(SENTENCE_END):
            segments.append(current)
            current = []
    if current:
        segments.append(current)
    return segments


def spread(text: str, start: float, end: float) -> list[Word]:
    """Timed words for `text` over [start, end], weighted by word length."""
    tokens = text.split()
    if not tokens:
        return []
    weights = [len(t) + 1 for t in tokens]
    total = sum(weights)
    out, t = [], start
    for token, weight in zip(tokens, weights, strict=True):
        d = (end - start) * weight / total
        out.append(Word(token, round(t, 3), round(t + d, 3)))
        t += d
    return out


def translate_words(
    llm: StructuredLLM,
    words: list[Word],
    language: str,
    log: Callable[[str], None] = lambda _: None,
) -> list[Word]:
    """`words` translated into `language` (a display name such as "Indonesian").

    A segment the model skips keeps its original words, so a partial answer
    never leaves a gap in the captions.
    """
    segments = segment_words(words)
    if not segments:
        return []
    prompt = "\n".join(f"[{i}] {' '.join(w.text for w in seg)}" for i, seg in enumerate(segments))
    answer = llm.structured(
        SYSTEM_PROMPT.format(language=language),
        f"Translate these {len(segments)} segments into {language}:\n\n{prompt}",
        TranslatedSegments,
    )
    by_id = {s.id: s.text.strip() for s in answer.segments}
    missing = [i for i in range(len(segments)) if not by_id.get(i)]
    if missing:
        log(f"translation: {len(missing)} of {len(segments)} segments untranslated")

    out: list[Word] = []
    for i, seg in enumerate(segments):
        text = by_id.get(i)
        out.extend(spread(text, seg[0].start, seg[-1].end) if text else seg)
    return out
