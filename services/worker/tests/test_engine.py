import json
import shutil
import subprocess

import pytest

from clipper_worker.engine import captions, highlights, reframe
from clipper_worker.engine.highlights import ProposedClip, ProposedClips
from clipper_worker.engine.transcript import Word, parse_json3, slice_words, to_prompt_lines
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


# Auto-caption style speech: 60 phrases of ten words, 0.4s apart, then about a
# second of silence. Each word "lasts" until the next starts, as in json3 tracks,
# and phrases start at x.6s so their [m:ss] markers drop a fraction.
PHRASES = [
    [Word(f"p{k}w{j}", 5 * k + 0.6 + 0.4 * j, 5 * k + 0.6 + 0.4 * (j + 1) if j < 9 else 5 * k + 5.6)
     for j in range(10)]
    for k in range(60)
]  # fmt: skip
SPEECH = [w for p in PHRASES for w in p]


def test_prompt_lines_follow_pauses_in_auto_captions():
    lines = to_prompt_lines(SPEECH).splitlines()
    assert len(lines) == 60
    assert lines[2] == "[0:10] " + " ".join(f"p2w{j}" for j in range(10))


def test_clips_start_and_end_between_phrases():
    fake = FakeHighlighter([
        clip("0:10", "0:45"),  # lines 2..9
        clip("0:30", "1:10"),  # overlaps the first
        clip("2:00", "2:10"),  # too short for 30-60
        clip("1:40", "2:45"),  # end read as "the line after" to fit 60s
        clip("nonsense", "1:00"),
    ])  # fmt: skip
    got = highlights.find_highlights(
        fake, SPEECH, title="T", window=(0, 300), length_range=(30, 60), output_language="English"
    )
    for c, (a, b) in zip(got, [(2, 9), (20, 32)], strict=True):
        first, last = PHRASES[a][0], PHRASES[b][-1]
        # Opens just before the first word, after the previous phrase stopped...
        assert PHRASES[a - 1][-1].start + 0.5 < c.start < first.start
        # ...and closes after the last word, before the next phrase begins.
        assert last.start + 0.4 < c.end < PHRASES[b + 1][0].start


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
    f = reframe.tracking_filter([(0, 0.25), (6, 0.8)], 1920, 1080)
    assert f.sendcmd and "crop x" in f.sendcmd
    assert "sendcmd=f='{cmds}'" in f.filter
    assert reframe.tracking_filter([], 1920, 1080).sendcmd is None


def podcast(talking, seconds=20.0, cut_at=None):
    """Samples of four seated people; `talking(person, t)` says whose lips move."""
    samples = []
    for i in range(int(seconds * 6)):
        t = i / 6
        shot = 1 if cut_at is not None and t >= cut_at else 0
        faces = tuple(
            reframe.Face(
                track=shot * 10 + p,
                x=0.15 + 0.23 * p,
                # The listener on the right sits closest to the camera.
                area=0.02 if p == 3 else 0.01,
                activity=0.6 if talking(p, t) else 0.05,
            )
            for p in range(4)
        )
        samples.append(reframe.Sample(t, faces, cut=shot == 1 and samples[-1].faces[0].track < 10))
    return samples


def speech(*spans):
    return [
        Word("w", t, t + 0.3)
        for a, b in spans
        for t in [a + i * 0.35 for i in range(int((b - a) / 0.35))]
    ]


def test_crop_stays_on_the_storyteller_through_a_laugh():
    # Person 1 tells a story; person 3 (the biggest face) bursts out laughing
    # and shouting for 1.5s in the middle of it.
    def talking(p, t):
        return (p == 1 and t < 20) or (p == 3 and 8 <= t < 9.5)

    plan = reframe.plan_speaker_crops(podcast(talking), speech((0, 20)))
    assert plan == [(0.0, pytest.approx(0.38))]


def test_crop_moves_when_someone_else_takes_over():
    def talking(p, t):
        return (p == 0 and t < 10) or (p == 2 and t >= 10.5) or (p == 0 and 15 <= t < 15.8)

    plan = reframe.plan_speaker_crops(podcast(talking), speech((0, 10), (10.5, 20)))
    assert [round(x, 2) for _, x in plan] == [0.15, 0.61]
    assert plan[1][0] == pytest.approx(10.5, abs=0.5)


def test_crop_ignores_lip_movement_while_nobody_speaks():
    # Person 2 chews/laughs silently in a pause; the transcript has no words then.
    def talking(p, t):
        return (p == 0 and t < 8) or (p == 2 and 8 <= t < 12) or (p == 0 and t >= 12)

    plan = reframe.plan_speaker_crops(podcast(talking), speech((0, 8), (12, 20)))
    assert [round(x, 2) for _, x in plan] == [0.15]


def test_crop_follows_a_camera_cut():
    def talking(p, t):
        return p == 1

    plan = reframe.plan_speaker_crops(podcast(talking, cut_at=10.0), speech((0, 20)))
    # New shot: biggest face first, then the speaker within that shot.
    assert [round(x, 2) for _, x in plan] == [0.38, 0.84, 0.38]
    assert plan[1][0] == pytest.approx(10.0, abs=0.2)


def test_crop_falls_back_to_the_largest_face_without_speech():
    plan = reframe.plan_speaker_crops(podcast(lambda p, t: False), [])
    assert [round(x, 2) for _, x in plan] == [0.84]
    assert reframe.plan_speaker_crops([reframe.Sample(0.0, ())], []) == []


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
    # Lines [0:08] through [0:16] of the transcript, 8.55s to 24.12s.
    assert float(probe["format"]["duration"]) == pytest.approx(15.6, abs=0.3)
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


def test_slice_words_leaves_out_the_previous_sentence_tail():
    # Auto-caption words run on through the silence after them: "plannya." is
    # spoken by 2712.72 but its caption lasts until the next word at 2713.12.
    words = [
        Word("plannya.", 2711.96, 2713.119),
        Word("Terus", 2713.12, 2713.5),
        Word("besok", 2713.5, 2713.9),
    ]
    assert [w.text for w in slice_words(words, 2712.87, 2714.0)] == ["Terus", "besok"]
    # A cut inside a word that is still being spoken keeps it.
    assert [w.text for w in slice_words(words, 2712.2, 2714.0)][0] == "plannya."


def test_cold_open_is_a_later_line_inside_the_clip():
    fake = FakeHighlighter([
        clip("0:10", "0:45", teaser_start="0:30", teaser_end="0:30"),  # line 6: kept
        clip("1:00", "1:35", teaser_start="1:00"),  # the clip's own first line
        clip("2:00", "2:35", teaser_start="2:10", teaser_end="2:15"),  # two lines, ~9s
        clip("3:00", "3:35", teaser_start="4:00"),  # outside the clip
    ])  # fmt: skip
    got = highlights.find_highlights(
        fake, SPEECH, title="T", window=(0, 300), length_range=(30, 60), output_language="English"
    )
    assert len(got) == 4
    start, end = got[0].teaser
    assert PHRASES[5][-1].start < start < PHRASES[6][0].start
    assert PHRASES[6][-1].start < end < PHRASES[7][0].start
    assert [c.teaser for c in got[1:]] == [None, None, None]


@ffmpeg
def test_cold_open_plays_the_teaser_then_the_whole_clip(tmp_path):
    from clipper_worker.engine.render import RenderSettings, _join_cold_open, render_clip

    video = tmp_path / "in.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i",
         "testsrc2=s=640x360:r=25:d=20", "-f", "lavfi", "-i", "sine=d=20",
         "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
         "-c:a", "aac", str(video)],
        check=True,
    )  # fmt: skip
    words = [Word(f"w{i}", 100 + i, 100.5 + i) for i in range(20)]  # source starts at 100s
    h = highlights.Highlight(102, 108, "t", "hook", "d", 80, "r", teaser=(110, 112))

    joined, moved_clip, moved = _join_cold_open(video, 100.0, h, words, tmp_path, "c")
    assert (moved_clip.start, moved_clip.end, moved_clip.teaser) == (0.0, 8.0, None)
    assert [w.text for w in moved] == ["w10", "w11", "w2", "w3", "w4", "w5", "w6", "w7"]
    assert moved[0].start == 0.0 and moved[2].start == pytest.approx(2.0)

    out, _thumb = render_clip(video, 100.0, h, words, RenderSettings(layout="fill"), tmp_path, "c")
    probe = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type:format=duration",
         "-of", "json", str(out)],
        check=True, capture_output=True, text=True).stdout)  # fmt: skip
    assert float(probe["format"]["duration"]) == pytest.approx(8.0, abs=0.2)
    assert any(s["codec_type"] == "audio" for s in probe["streams"])


def test_captions_break_where_the_cold_open_cuts_to_the_clip():
    words = [Word(w, i * 0.4, i * 0.4 + 0.35) for i, w in enumerate("a b c d e".split())]
    chunks = captions.chunk_words(words, 3, cuts=(0.7,))
    assert [[w.text for w in c] for c in chunks] == [["a", "b"], ["c", "d", "e"]]
