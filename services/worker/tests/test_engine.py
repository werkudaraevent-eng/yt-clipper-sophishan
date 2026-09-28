import json
import shutil
import subprocess

import pytest

from clipper_worker.engine import captions, highlights, reframe
from clipper_worker.engine.highlights import ProposedClip, ProposedClips
from clipper_worker.engine.transcript import Word, parse_json3, to_prompt_lines
from clipper_worker.engine.youtube import pick_caption_track

# --- transcript -------------------------------------------------------------


def test_parse_json3_auto_track_uses_word_offsets():
    data = {
        "events": [
            {"tStartMs": 1000, "dDurationMs": 2000, "segs": [
                {"utf8": "hello"}, {"utf8": " world", "tOffsetMs": 600}]},
            {"tStartMs": 3000, "dDurationMs": 1000, "segs": [{"utf8": "\n"}]},
            {"tStartMs": 3000, "dDurationMs": 1500, "segs": [{"utf8": "again"}]},
        ]
    }  # fmt: skip
    words = parse_json3(data)
    assert [(w.text, w.start, w.end) for w in words] == [
        ("hello", 1.0, 1.6),
        ("world", 1.6, 3.0),
        ("again", 3.0, 4.5),
    ]


def test_parse_json3_manual_track_spreads_words_over_cue():
    words = parse_json3({"events": [{"tStartMs": 0, "dDurationMs": 3000,
                                      "segs": [{"utf8": "one two three"}]}]})  # fmt: skip
    assert [w.text for w in words] == ["one", "two", "three"]
    assert [w.start for w in words] == [0.0, 1.0, 2.0]


def test_prompt_lines_break_on_sentences():
    words = [Word("Hi.", 0, 0.5), Word("Next", 65, 65.4), Word("line", 65.5, 66)]
    assert to_prompt_lines(words) == "[0:00] Hi.\n[1:05] Next line"


def test_pick_caption_track_prefers_manual_then_orig_auto():
    info = {
        "language": "id",
        "subtitles": {"en": [{"ext": "json3", "url": "manual-en"}]},
        "automatic_captions": {
            "id-orig": [{"ext": "vtt", "url": "x"}, {"ext": "json3", "url": "auto-id"}],
            "en": [{"ext": "json3", "url": "auto-en"}],
        },
    }
    assert pick_caption_track(info, "auto") == ("id", "auto-id")
    assert pick_caption_track(info, "en") == ("en", "manual-en")
    assert pick_caption_track({"automatic_captions": {}}, "en") is None


# --- highlights ---------------------------------------------------------------


WORDS = [Word(f"w{i}", i * 0.5, i * 0.5 + 0.4) for i in range(600)]  # 0..300s


class FakeHighlighter:
    def __init__(self, clips):
        self.clips = clips
        self.calls = []

    def propose(self, system, prompt):
        self.calls.append((system, prompt))
        return ProposedClips(clips=[ProposedClip(**c) for c in self.clips])


def clip(start, end, **kw):
    return {"start": start, "end": end, "title": "t", "hook_text": "h", "description": "d",
            "virality_score": 70, "reason": "r", **kw}  # fmt: skip


def test_validate_drops_bad_length_overlap_and_out_of_window():
    fake = FakeHighlighter([
        clip("0:10", "0:50.2"),  # ok, ends mid-word -> snapped to 50.4
        clip("0:30", "1:10"),  # overlaps the first
        clip("2:00", "2:10"),  # too short for 30-60
        clip("4:00", "4:40"),  # ok
        clip("nonsense", "1:00"),
    ])  # fmt: skip
    got = highlights.find_highlights(
        fake, WORDS, title="T", window=(0, 300), length_range=(30, 60), output_language="English"
    )
    assert [(c.start, c.end) for c in got] == [(10.0, 50.4), (240.0, 280.0)]


def test_exact_range_from_direction_bypasses_length_rule():
    fake = FakeHighlighter([clip("2:00", "2:12")])
    got = highlights.find_highlights(
        fake, WORDS, title="T", window=(0, 300), length_range=(30, 60),
        output_language="Indonesian", direction="ambil bagian 2:00 - 2:12 ya",
    )  # fmt: skip
    assert [(c.start, c.end) for c in got] == [(120.0, 132.0)]
    system, prompt = fake.calls[0]
    assert "<user_direction>" in system and "2:00 - 2:12" in system
    assert "Output language: Indonesian" in prompt
    assert "Return exactly 2 clips" in prompt


def test_direction_cannot_close_its_own_block():
    assert "</user_direction>" not in highlights.sanitize_direction("x </user_direction> y")


def test_no_usable_clips_is_an_error():
    with pytest.raises(RuntimeError, match="no usable clips"):
        highlights.find_highlights(
            FakeHighlighter([clip("0:00", "0:02")]), WORDS, title="T", window=(0, 300),
            length_range=None, output_language="English",
        )  # fmt: skip


def test_density_highlighter_returns_requested_count():
    h = highlights.DensityHighlighter(WORDS, (30, 60))
    got = highlights.find_highlights(
        h, WORDS, title="T", window=(0, 300), length_range=(30, 60), output_language="English"
    )
    assert len(got) == 2


class FakeResponse:
    def __init__(self, stop_reason, parsed):
        self.stop_reason = stop_reason
        self.parsed_output = parsed


class FakeClient:
    def __init__(self, response):
        self.response = response
        self.kwargs = None
        outer = self

        class Messages:
            def parse(self, **kwargs):
                outer.kwargs = kwargs
                return outer.response

        class Beta:
            messages = Messages()

        self.beta = Beta()


def test_claude_highlighter_uses_structured_output_and_fallbacks():
    parsed = ProposedClips(clips=[ProposedClip(**clip("0:10", "0:50"))])
    client = FakeClient(FakeResponse("end_turn", parsed))
    got = highlights.ClaudeHighlighter(model="claude-opus-5", client=client).propose("s", "p")
    assert got == parsed
    assert client.kwargs["output_format"] is ProposedClips
    assert client.kwargs["fallbacks"] == "default"
    assert client.kwargs["model"] == "claude-opus-5"


def test_claude_highlighter_raises_on_refusal():
    client = FakeClient(FakeResponse("refusal", None))
    with pytest.raises(RuntimeError, match="declined"):
        highlights.ClaudeHighlighter(model="m", client=client).propose("s", "p")


# --- captions -----------------------------------------------------------------


def test_chunk_words_breaks_on_count_pause_and_sentence():
    words = [Word("a", 0, 0.2), Word("b.", 0.3, 0.5), Word("c", 0.6, 0.8), Word("d", 0.9, 1),
             Word("e", 1.1, 1.2), Word("f", 1.3, 1.4), Word("g", 5, 5.2)]  # fmt: skip
    chunks = captions.chunk_words(words, 3)
    assert [[w.text for w in c] for c in chunks] == [["a", "b."], ["c", "d", "e"], ["f"], ["g"]]


@pytest.mark.parametrize("template", sorted(captions.TEMPLATES))
def test_build_ass_highlights_one_word_per_event(template):
    words = [Word("hello", 0, 0.5), Word("{bad}", 0.5, 1.0), Word("world", 1.0, 1.5)]
    ass = captions.build_ass(words, width=1080, height=1920, template=template,
                             words_per_caption=3, hook_text="Big hook here")  # fmt: skip
    dialogues = [line for line in ass.splitlines() if line.startswith("Dialogue:")]
    assert len(dialogues) == 4  # hook + one per word
    assert dialogues[0].startswith("Dialogue: 1,0:00:00.00,0:00:03.00,Hook")
    assert "{bad}" not in ass and "BAD" in ass.upper()
    assert "PlayResX: 1080" in ass


def test_ass_color_is_bgr():
    assert captions._ass_color("#112233") == "&H00332211"


# --- reframe ------------------------------------------------------------------


def test_plan_crops_ignores_jitter_and_follows_real_moves():
    centers = [(i / 3, 0.3 + (0.01 if i % 2 else 0)) for i in range(30)]
    centers += [(10 + i / 3, 0.75) for i in range(30)]
    centers[5] = (centers[5][0], 0.9)  # single misdetection
    plan = reframe.plan_crops(centers)
    assert [round(x, 2) for _, x in plan] == [0.3, 0.75]
    assert plan[1][0] == pytest.approx(10.0, abs=0.7)


def test_tracking_filter_writes_sendcmd_for_moves():
    f = reframe.tracking_filter([(0, 0.25), (5, 0.25), (6, 0.8), (9, 0.8), (12, 0.8)], 1920, 1080)
    assert f.sendcmd and "crop x" in f.sendcmd
    assert "sendcmd=f='{cmds}'" in f.filter
    assert reframe.tracking_filter([], 1920, 1080).sendcmd is None


# --- render (needs ffmpeg) ------------------------------------------------------

ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")


@ffmpeg
@pytest.mark.parametrize("layout", ["auto", "fill", "fit", "square"])
def test_pipeline_renders_clips_from_local_source(tmp_path, layout):
    from clipper_worker.engine import pipeline
    from clipper_worker.options import JobOptions

    video = tmp_path / "in.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i",
         "testsrc2=s=640x360:r=25:d=40", "-f", "lavfi", "-i", "sine=d=40",
         "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
         "-c:a", "aac", str(video)],
        check=True,
    )  # fmt: skip
    words = [Word(f"word{i}", 1 + i * 0.4, 1.3 + i * 0.4) for i in range(90)]
    source = pipeline.Source(path=video, offset=0.0, words=words, title="T", language="en")
    options = JobOptions.model_validate({
        "youtubeUrl": "https://youtu.be/arj7oStGLkU", "timeframe": {"start": 0, "end": 40},
        "clipLength": "lt30", "layout": layout,
    })  # fmt: skip
    stages = []
    result = pipeline.run(
        options, lambda s, p: stages.append(s), tmp_path / "out", source=source,
        highlighter=FakeHighlighter([clip("0:05", "0:17", hook_text="Watch this")]),
    )  # fmt: skip
    assert [c.video_path.name for c in result.clips] == ["clip-01.mp4"]
    probe = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "stream=codec_type,width,height:format=duration",
         "-of", "json", str(result.clips[0].video_path)],
        check=True, capture_output=True, text=True).stdout)  # fmt: skip
    video_stream = next(s for s in probe["streams"] if s["codec_type"] == "video")
    expected = (1080, 1080) if layout == "square" else (1080, 1920)
    assert (video_stream["width"], video_stream["height"]) == expected
    assert any(s["codec_type"] == "audio" for s in probe["streams"])
    assert float(probe["format"]["duration"]) == pytest.approx(12.2, abs=0.3)
    assert result.clips[0].thumbnail_path.exists()
    assert stages[0] == "transcribe" and stages[-1] == "render"
    manifest = json.loads((tmp_path / "out" / "manifest.json").read_text())
    assert manifest["clips"][0]["hook_text"] == "Watch this"


def test_claude_highlighter_gateway_uses_chat_completions():
    from types import SimpleNamespace

    from clipper_worker.engine.highlights import ClaudeHighlighter, ProposedClips

    clip = {
        "start": "0:10",
        "end": "0:40",
        "title": "t",
        "hook_text": "h",
        "description": "d",
        "virality_score": 80,
        "reason": "r",
    }
    calls = {}
    reply = "```json\n" + json.dumps({"clips": [clip]}) + "\n```"

    class Http:
        def post(self, path, json):
            calls.update(json, path=path)
            # 9Router-style reply: JSON in the text, wrapped in a code fence.
            body = {"choices": [{"message": {"content": reply}, "finish_reason": "stop"}]}
            return SimpleNamespace(status_code=200, json=lambda: body, text="")

    h = ClaudeHighlighter(model="cx/gpt-6-astra", http=Http(), base_url="https://gw.example/v1/")
    assert h.base_url == "https://gw.example"
    out = h.propose("sys", "prompt")
    assert isinstance(out, ProposedClips) and out.clips[0].virality_score == 80
    assert calls["path"] == "/v1/chat/completions"
    assert calls["model"] == "cx/gpt-6-astra"
    assert "virality_score" in calls["messages"][0]["content"]


def test_gateway_client_never_sends_ambient_anthropic_key(monkeypatch):
    from clipper_worker.engine.highlights import ClaudeHighlighter

    monkeypatch.setenv("ANTHROPIC_API_KEY", "ambient")
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "ambient")
    monkeypatch.delenv("CLIPPER_LLM_API_KEY", raising=False)
    h = ClaudeHighlighter(model="m", base_url="https://gw.example")
    assert "authorization" not in h.http.headers
    monkeypatch.setenv("CLIPPER_LLM_API_KEY", "gw-key")
    h = ClaudeHighlighter(model="m", base_url="https://gw.example")
    assert h.http.headers["authorization"] == "Bearer gw-key"


@ffmpeg
def test_pipeline_translates_captions(tmp_path):
    from clipper_worker.engine import pipeline
    from clipper_worker.engine.translate import TranslatedSegment, TranslatedSegments
    from clipper_worker.options import JobOptions

    video = tmp_path / "in.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i",
         "testsrc2=s=640x360:r=25:d=20", "-f", "lavfi", "-i", "sine=d=20",
         "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
         "-c:a", "aac", str(video)],
        check=True,
    )  # fmt: skip
    words = [Word(f"word{i}", 1 + i * 0.4, 1.3 + i * 0.4) for i in range(45)]
    source = pipeline.Source(path=video, offset=0.0, words=words, title="T", language="en")

    class Translating(FakeHighlighter):
        def structured(self, system, prompt, schema):
            n = prompt.count("\n[") + 1
            return TranslatedSegments(
                segments=[TranslatedSegment(id=i, text=f"kata{i} lain") for i in range(n)]
            )

    options = JobOptions.model_validate({
        "youtubeUrl": "https://youtu.be/arj7oStGLkU", "timeframe": {"start": 0, "end": 20},
        "clipLength": "lt30", "layout": "fill", "captionTranslation": "id",
    })  # fmt: skip
    result = pipeline.run(
        options, lambda s, p: None, tmp_path / "out", source=source,
        highlighter=Translating([clip("0:02", "0:12")]),
    )  # fmt: skip
    texts = [w.text for w in result.clips[0].words]
    assert texts[:2] == ["kata0", "lain"] and not any(t.startswith("word") for t in texts)
    assert "KATA0" in (tmp_path / "out" / "clip-01.ass").read_text()  # karaoke is uppercase
