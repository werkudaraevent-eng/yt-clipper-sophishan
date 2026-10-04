import sys
import types

from clipper_worker.engine import pipeline, youtube


def test_progress_hook_spans_video_and_audio_files():
    seen: list[float] = []
    hook = youtube._progress_hook(seen.append)
    info = {"requested_formats": [{}, {}]}

    hook(
        {
            "status": "downloading",
            "filename": "v",
            "downloaded_bytes": 50,
            "total_bytes": 100,
            "info_dict": info,
        }
    )
    hook(
        {
            "status": "downloading",
            "filename": "a",
            "downloaded_bytes": 10,
            "total_bytes": 10,
            "info_dict": info,
        }
    )
    hook({"status": "finished", "filename": "a"})

    assert seen == [0.25, 1.0]


def test_progress_hook_ignores_chunks_without_a_size():
    seen: list[float] = []
    youtube._progress_hook(seen.append)(
        {"status": "downloading", "filename": "v", "downloaded_bytes": 5}
    )
    assert seen == []


def test_stage_reporter_maps_onto_range_and_throttles(monkeypatch):
    calls: list[tuple[str, float]] = []
    clock = iter([10.0, 10.5, 13.0, 13.1])
    monkeypatch.setattr(pipeline.time, "monotonic", lambda: next(clock))
    on_progress = pipeline.stage_reporter(lambda s, p: calls.append((s, p)), "download", 0.0, 0.2)

    on_progress(0.5)  # t=10: reported
    on_progress(0.6)  # t=10.5: throttled
    on_progress(0.7)  # t=13: reported
    on_progress(1.0)  # t=13.1: the end is always reported

    assert [(s, round(p, 3)) for s, p in calls] == [
        ("download", 0.1),
        ("download", 0.14),
        ("download", 0.2),
    ]


def _fake_yt_dlp(monkeypatch, captured: dict):
    class FakeYDL:
        def __init__(self, opts):
            captured.update(opts)

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def download(self, urls):
            from pathlib import Path

            Path(captured["outtmpl"].replace("%(ext)s", "mp4")).write_bytes(b"x")

    utils = types.SimpleNamespace(download_range_func=lambda *a: ("ranges", a))
    monkeypatch.setitem(
        sys.modules, "yt_dlp", types.SimpleNamespace(YoutubeDL=FakeYDL, utils=utils)
    )
    monkeypatch.setitem(sys.modules, "yt_dlp.utils", utils)


def test_whole_video_is_downloaded_without_cutting(monkeypatch, tmp_path):
    captured: dict = {}
    _fake_yt_dlp(monkeypatch, captured)
    youtube.download_section("u", 0, 840, tmp_path, duration=840)
    assert "download_ranges" not in captured
    assert "force_keyframes_at_cuts" not in captured


def test_partial_range_is_stream_copied(monkeypatch, tmp_path):
    captured: dict = {}
    _fake_yt_dlp(monkeypatch, captured)
    youtube.download_section("u", 60, 300, tmp_path, duration=840, on_progress=lambda f: None)
    # Re-encoding at the cuts pinned every core for minutes with no progress.
    assert "force_keyframes_at_cuts" not in captured
    assert "download_ranges" in captured
    assert "-rw_timeout" in captured["external_downloader_args"]["ffmpeg_i"]
    assert len(captured["progress_hooks"]) == 1


def test_expected_bytes_uses_the_picked_formats():
    info = {
        "formats": [
            {"vcodec": "avc1.640028", "height": 1080, "tbr": 2000},
            {"vcodec": "avc1.4d401f", "height": 720, "tbr": 1000},
            {"vcodec": "vp9", "height": 2160, "tbr": 9000},
            {"vcodec": "none", "ext": "m4a", "abr": 128, "tbr": 128},
            {"vcodec": "none", "ext": "webm", "abr": 160, "tbr": 160},
        ]
    }
    assert youtube._expected_bytes(info, 10) == (2000 + 128) * 1000 / 8 * 10
    assert youtube._expected_bytes({"formats": []}, 10) is None


def test_size_watcher_reports_file_growth(tmp_path):
    import time

    seen: list[float] = []
    watcher = youtube._SizeWatcher(tmp_path, 1000, seen.append)
    (tmp_path / "source.mp4.part").write_bytes(b"x" * 400)
    watcher.start()
    time.sleep(2.3)
    watcher.stop()
    assert seen == [0.4]
