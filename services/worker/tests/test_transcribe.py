import sys
import types
from pathlib import Path

import pytest

from clipper_worker.engine import pipeline
from clipper_worker.engine.transcript import Word, transcribe_audio
from clipper_worker.options import JobOptions

CAPTIONS = [Word("caption", 100.0, 100.5)]


def _fake_whisper(monkeypatch, calls: list, words=(("Halo", 0.5, 0.9), ("guys", 1.0, 1.3))):
    class FakeModel:
        def __init__(self, size, **kw):
            calls.append(("model", size))

        def transcribe(self, path, **kw):
            calls.append(("transcribe", kw))
            seg = types.SimpleNamespace(
                end=2.0, words=[types.SimpleNamespace(word=f" {t}", start=s, end=e)
                                for t, s, e in words],
            )  # fmt: skip
            return iter([seg]), types.SimpleNamespace(duration=2.0, language="id")

    monkeypatch.setitem(
        sys.modules, "faster_whisper", types.SimpleNamespace(WhisperModel=FakeModel)
    )


def _options(language="auto"):
    return JobOptions.model_validate({
        "youtubeUrl": "https://youtu.be/arj7oStGLkU", "timeframe": {"start": 0, "end": 600},
        "videoLanguage": language,
    })  # fmt: skip


def _source(**kw):
    return pipeline.Source(
        path=Path("src.mp4"), offset=100.0, words=list(CAPTIONS), title="T", language="id",
        transcribe=True, **kw,
    )  # fmt: skip


def test_whisper_words_replace_captions_on_the_video_timeline(monkeypatch):
    calls: list = []
    _fake_whisper(monkeypatch, calls)
    source = _source()
    pipeline.transcribe(source, _options(), lambda s, p: None)
    assert source.words == [Word("Halo", 100.5, 100.9), Word("guys", 101.0, 101.3)]
    assert calls[0] == ("model", "large-v3-turbo")
    # The captions' language is named, so Indonesian isn't taken for Malay.
    assert calls[1][1]["language"] == "id"
    assert calls[1][1]["multilingual"] is False
    assert calls[1][1]["word_timestamps"] is True


def test_the_users_language_wins(monkeypatch):
    calls: list = []
    _fake_whisper(monkeypatch, calls)
    pipeline.transcribe(_source(), _options("en"), lambda s, p: None)
    assert calls[1][1]["language"] == "en"


def test_unknown_language_is_detected_per_segment(monkeypatch):
    calls: list = []
    _fake_whisper(monkeypatch, calls)
    language, words = transcribe_audio(Path("a.mp4"), "auto", "small")
    assert calls[1][1]["language"] is None and calls[1][1]["multilingual"] is True
    assert language == "id" and [w.text for w in words] == ["Halo", "guys"]


def test_captions_stay_when_whisper_fails(monkeypatch):
    class Broken:
        def __init__(self, *a, **kw):
            raise OSError("model download failed")

    monkeypatch.setitem(sys.modules, "faster_whisper", types.SimpleNamespace(WhisperModel=Broken))
    source = _source()
    pipeline.transcribe(source, _options(), lambda s, p: None)
    assert source.words == CAPTIONS


def test_whisper_failure_without_captions_fails_the_job(monkeypatch):
    class Broken:
        def __init__(self, *a, **kw):
            raise OSError("model download failed")

    monkeypatch.setitem(sys.modules, "faster_whisper", types.SimpleNamespace(WhisperModel=Broken))
    source = _source()
    source.words = []
    with pytest.raises(OSError):
        pipeline.transcribe(source, _options(), lambda s, p: None)


def test_youtube_mode_keeps_the_caption_track(monkeypatch):
    monkeypatch.setenv("CLIPPER_TRANSCRIBER", "youtube")
    assert pipeline.transcriber() == "youtube"
    monkeypatch.delenv("CLIPPER_TRANSCRIBER")
    assert pipeline.transcriber() == "whisper"
