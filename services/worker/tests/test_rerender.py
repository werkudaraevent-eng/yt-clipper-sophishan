import json
import subprocess
from uuid import uuid4

import numpy as np
import pytest

from clipper_worker.engine import pipeline
from clipper_worker.engine.highlights import Highlight
from clipper_worker.engine.render import RenderSettings, render_clip
from clipper_worker.engine.rerender import ClipRow, best_match, rerender
from clipper_worker.engine.transcript import Word, apply_terms
from clipper_worker.options import ClipEdit, JobOptions

OPTIONS = JobOptions.model_validate(
    {"youtubeUrl": "https://youtu.be/arj7oStGLkU", "timeframe": {"start": 0, "end": 40},
     "layout": "fill"}
)  # fmt: skip
# One word a second, "w0" at 0 s to "w39" at 39 s.
WORDS = [Word(f"w{i}", float(i), i + 0.5) for i in range(40)]


@pytest.fixture(scope="module")
def video(tmp_path_factory):
    """40 s of test picture over noise, so every moment sounds different."""
    path = tmp_path_factory.mktemp("src") / "in.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i",
         "testsrc2=s=640x360:r=25:d=40", "-f", "lavfi", "-i", "anoisesrc=d=40:c=pink:seed=7",
         "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
         "-c:a", "aac", str(path)],
        check=True,
    )  # fmt: skip
    return path


def fake_fetch(video, seen=None):
    def fetch(options, work, report):
        if seen is not None:
            seen.append((options.timeframe.start, options.timeframe.end))
        return pipeline.Source(path=video, offset=0.0, words=list(WORDS), title="T",
                               language="en")  # fmt: skip

    return fetch


def clip_row(render=None, start=10.0, end=22.0, path=None):
    return ClipRow(
        id=uuid4(), position=0, start=start, end=end, title="T", hook_text="Old hook",
        description="d", virality_score=80, reason="r", video_path=path,
        words=[w for w in WORDS if start <= w.start < end], render=render,
    )  # fmt: skip


def duration(path):
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
        check=True, capture_output=True, text=True,
    )  # fmt: skip
    return float(json.loads(probe.stdout)["format"]["duration"])


LOOK = {"template": "karaoke", "position": "bottom", "wordsPerCaption": 3, "layout": "fill",
        "hookTitle": True, "coldOpen": True, "teaser": [16.0, 18.5]}  # fmt: skip


def test_caption_fix_keeps_the_cut_and_the_cold_open(video, tmp_path):
    seen = []
    clip = clip_row(render=LOOK)
    words = [{"text": "Matheus" if w.text == "w12" else w.text, "start": w.start, "end": w.end}
             for w in clip.words]  # fmt: skip
    edit = ClipEdit.model_validate({"words": words, "hook": " New hook "})

    out = rerender(OPTIONS, clip, edit, tmp_path, lambda *_: None, fetch=fake_fetch(video, seen))

    assert seen == [(9.0, 23.0)]  # the cut plus a second either side
    assert (out.start, out.end, out.hook_text) == (10.0, 22.0, "New hook")
    assert [w.text for w in out.words][:3] == ["w10", "w11", "Matheus"]
    assert out.render == LOOK
    assert out.video_path.name == "clip-01.mp4" and out.thumbnail_path.exists()
    assert duration(out.video_path) == pytest.approx(12 + 2.5, abs=0.2)


def test_longer_cut_adds_the_words_heard_there(video, tmp_path):
    clip = clip_row(render=LOOK)
    edit = ClipEdit.model_validate({"start": 6.0, "end": 24.0})

    out = rerender(OPTIONS, clip, edit, tmp_path, lambda *_: None, fetch=fake_fetch(video))

    assert [w.text for w in out.words] == [f"w{i}" for i in range(6, 24)]
    assert duration(out.video_path) == pytest.approx(18 + 2.5, abs=0.2)


def test_a_cut_past_the_teaser_drops_the_cold_open_but_remembers_it(video, tmp_path):
    clip = clip_row(render=LOOK)
    edit = ClipEdit.model_validate({"start": 10.0, "end": 15.0})

    out = rerender(OPTIONS, clip, edit, tmp_path, lambda *_: None, fetch=fake_fetch(video))

    assert duration(out.video_path) == pytest.approx(5.0, abs=0.2)
    assert out.render["teaser"] == [16.0, 18.5] and out.render["coldOpen"] is True


def test_style_change_overrides_only_the_keys_given(video, tmp_path):
    clip = clip_row(render=LOOK)
    edit = ClipEdit.model_validate({"style": {"template": "box", "coldOpen": False}})

    out = rerender(OPTIONS, clip, edit, tmp_path, lambda *_: None, fetch=fake_fetch(video))

    assert out.render == {**LOOK, "template": "box", "coldOpen": False}
    assert duration(out.video_path) == pytest.approx(12.0, abs=0.2)


def test_old_clips_get_their_cold_open_back_from_the_file(video, tmp_path):
    # Rendered before the editor: the row does not say where the teaser was.
    old = Highlight(10.0, 22.0, "T", "Old hook", "d", 80, "r", teaser=(16.0, 18.5))
    current, _ = render_clip(video, 0.0, old, WORDS, RenderSettings(layout="fill"),
                             tmp_path / "old", "clip-01")  # fmt: skip
    clip = clip_row(path=str(current))
    edit = ClipEdit.model_validate({"hook": "New hook"})

    out = rerender(
        OPTIONS, clip, edit, tmp_path / "new", lambda *_: None, fetch=fake_fetch(video),
        current_video=lambda: current,
    )  # fmt: skip

    s, e = out.render["teaser"]
    assert s == pytest.approx(16.0, abs=0.05) and e == pytest.approx(18.5, abs=0.1)
    assert duration(out.video_path) == pytest.approx(14.5, abs=0.2)


def test_old_clips_without_a_cold_open_stay_without(video, tmp_path):
    old = Highlight(10.0, 22.0, "T", "Old hook", "d", 80, "r")
    current, _ = render_clip(video, 0.0, old, WORDS, RenderSettings(layout="fill"),
                             tmp_path / "old", "clip-01")  # fmt: skip
    clip = clip_row(path=str(current))

    out = rerender(
        OPTIONS, clip, ClipEdit.model_validate({"hook": "x"}), tmp_path / "new",
        lambda *_: None, fetch=fake_fetch(video), current_video=lambda: current,
    )  # fmt: skip

    assert out.render["teaser"] is None
    assert duration(out.video_path) == pytest.approx(12.0, abs=0.2)


def test_best_match_finds_a_snippet_and_rejects_strangers():
    rng = np.random.default_rng(3)
    hay = rng.standard_normal(8000 * 10)
    needle = hay[8000 * 4 : 8000 * 6] + 0.1 * rng.standard_normal(8000 * 2)
    assert best_match(needle, hay, 8000) == pytest.approx(4.0)
    assert best_match(rng.standard_normal(8000), hay, 8000) is None


def test_terms_respell_names_across_words_and_keep_punctuation():
    words = [
        Word("kata", 0, 0.3), Word("Mateus", 0.3, 0.7), Word("Kunya,", 0.7, 1.2),
        Word("sofis", 1.3, 1.6), Word("(tirta", 2, 2.4), Word("cipeng)", 2.4, 2.9),
    ]  # fmt: skip
    terms = [("mateus kunya", "Matheus Cunha"), ("Sofis", "Sofish"),
             ("tirta cipeng", "Tirta Cipeng"), ("kata", "dua kata")]  # fmt: skip
    out = apply_terms(words, terms)
    assert [w.text for w in out] == [
        "dua", "kata", "Matheus", "Cunha,", "Sofish", "(Tirta", "Cipeng)"
    ]  # fmt: skip
    # Two words where one was: the old word's time, split by length.
    assert (out[0].start, out[1].end) == (0, 0.3)
    assert out[2:4] == [Word("Matheus", 0.3, 0.7), Word("Cunha,", 0.7, 1.2)]


def test_terms_go_last_in_the_whisper_hint():
    hint = pipeline.with_terms("Video title.", [("a", "Matheus Cunha"), ("b", "Sofish")])
    assert hint == "Video title. Matheus Cunha, Sofish."
    assert pipeline.with_terms(None, []) == ""
