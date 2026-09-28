from clipper_worker.engine.transcript import Word
from clipper_worker.engine.translate import (
    TranslatedSegment,
    TranslatedSegments,
    segment_words,
    spread,
    translate_words,
)


def words(spec):
    return [Word(t, s, e) for t, s, e in spec]


SAMPLE = words(
    [
        ("This", 0.0, 0.3), ("is", 0.3, 0.5), ("great.", 0.5, 1.0),
        ("Watch", 2.5, 2.8), ("this", 2.8, 3.0), ("now", 3.0, 3.4),
    ]
)  # fmt: skip


def test_segments_split_on_sentence_end_and_pause():
    segs = segment_words(SAMPLE)
    assert [[w.text for w in s] for s in segs] == [
        ["This", "is", "great."],
        ["Watch", "this", "now"],
    ]


def test_spread_covers_the_span_in_order():
    out = spread("Ini keren banget", 1.0, 3.0)
    assert [w.text for w in out] == ["Ini", "keren", "banget"]
    assert out[0].start == 1.0 and abs(out[-1].end - 3.0) < 1e-6
    assert all(a.end <= b.start + 1e-6 for a, b in zip(out, out[1:], strict=False))
    assert out[2].end - out[2].start > out[0].end - out[0].start


class FakeLLM:
    def __init__(self, answer):
        self.answer = answer
        self.calls = []

    def structured(self, system, prompt, schema):
        self.calls.append((system, prompt, schema))
        return self.answer


def test_translate_keeps_segment_timing_and_falls_back_on_missing():
    llm = FakeLLM(TranslatedSegments(segments=[TranslatedSegment(id=0, text="Ini keren.")]))
    out = translate_words(llm, SAMPLE, "Indonesian")
    system, prompt, schema = llm.calls[0]
    assert (
        "Indonesian" in system and "[0] This is great." in prompt and "[1] Watch this now" in prompt
    )
    assert [w.text for w in out] == ["Ini", "keren.", "Watch", "this", "now"]
    assert out[0].start == 0.0 and abs(out[1].end - 1.0) < 1e-6
    assert out[2] == SAMPLE[3]


def test_pipeline_translation_target():
    from types import SimpleNamespace

    from clipper_worker.engine.pipeline import _translation_target

    def opts(tr, lang="auto"):
        return SimpleNamespace(caption_translation=tr, video_language=lang)

    src = SimpleNamespace(language="en-orig")
    assert _translation_target(opts(None), src) is None
    assert _translation_target(opts("en"), src) is None
    assert _translation_target(opts("id"), src) == "Indonesian"
