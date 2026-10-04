from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

from clipper_worker import main as worker_main
from clipper_worker.engine.rerender import Rerendered
from clipper_worker.engine.transcript import Word
from clipper_worker.queue import JobQueue

from .test_queue_position import _position

WORDS = [
    {"text": "Mateus", "start": 10.2, "end": 10.6},
    {"text": "Kunya", "start": 10.6, "end": 11},
]


def _as(conn, uid):
    conn.execute("set role authenticated")
    conn.execute("select set_config('request.jwt.claim.sub', %s, false)", (str(uid),))


def _buy(conn, uid):
    conn.execute(
        "insert into public.credit_orders "
        "(user_id, pack_id, credits, amount, invoice_number, status) "
        "values (%s, 'p30', 30, 19000, %s, 'paid')",
        (uid, f"INV-{uuid4().hex[:10]}"),
    )


@pytest.fixture
def ready_clip(conn, make_user, make_project):
    """A finished project with clips; returns (owner, [clip ids])."""

    def _make(user=None, buyer=False, clips=1, duration=600):
        user = user or make_user()
        if buyer:
            _buy(conn, user)
        project = make_project(user)
        conn.execute(
            "update public.jobs set status = 'succeeded', finished_at = now() "
            "where project_id = %s",
            (project,),
        )
        conn.execute(
            "update public.projects set status = 'ready', duration_seconds = %s where id = %s",
            (duration, project),
        )
        ids = [
            conn.execute(
                "insert into public.clips (project_id, position, start_seconds, end_seconds, "
                "hook_text, video_path, caption_words) values (%s, %s, %s, %s, 'Hook', %s, %s) "
                "returning id",
                (project, i, 10 + 60 * i, 40 + 60 * i, f"{user}/{project}/clip-{i + 1:02d}.mp4",
                 Jsonb(WORDS)),
            ).fetchone()["id"]
            for i in range(clips)
        ]  # fmt: skip
        return user, ids

    return _make


def _edit(conn, user, clip, edit, to_all=False):
    _as(conn, user)
    try:
        return conn.execute(
            "select public.edit_clip(%s, %s, %s) as n", (clip, Jsonb(edit), to_all)
        ).fetchone()["n"]
    finally:
        conn.execute("reset role")


def _jobs(conn, clip):
    return conn.execute(
        "select kind, status, payload from public.jobs where clip_id = %s", (clip,)
    ).fetchall()


def test_anyone_can_fix_caption_text_and_the_hook(conn, ready_clip):
    user, [clip] = ready_clip()
    edit = {"words": WORDS, "hook": "Siapa dia?"}
    assert _edit(conn, user, clip, edit) == 1
    assert _jobs(conn, clip) == [{"kind": "rerender_clip", "status": "queued", "payload": edit}]


@pytest.mark.parametrize(
    "edit", [{"start": 12}, {"end": 38}, {"style": {"template": "box"}}]
)  # fmt: skip
def test_cut_and_style_are_for_buyers(conn, ready_clip, edit):
    user, [clip] = ready_clip()
    with pytest.raises(psycopg.errors.RaiseException, match="buyers_only"):
        _edit(conn, user, clip, edit)
    assert _jobs(conn, clip) == []


def test_buyers_trim_within_30_seconds_of_the_ai_cut(conn, ready_clip):
    user, [clip] = ready_clip(buyer=True)
    assert _edit(conn, user, clip, {"start": 0, "end": 70}) == 1
    row = conn.execute(
        "select original_start, original_end from public.clips where id = %s", (clip,)
    ).fetchone()
    assert row == {"original_start": 10, "original_end": 40}
    conn.execute("update public.jobs set status = 'succeeded' where clip_id = %s", (clip,))
    # Moved since, but the window stays on the AI's cut.
    conn.execute(
        "update public.clips set start_seconds = 0, end_seconds = 70 where id = %s", (clip,)
    )
    for bad in ({"end": 71}, {"start": 30, "end": 32}, {"start": 0, "end": 190}):
        with pytest.raises(psycopg.errors.RaiseException, match="bad_trim"):
            _edit(conn, user, clip, bad)


def test_trim_stops_at_the_end_of_the_video(conn, ready_clip):
    user, [clip] = ready_clip(buyer=True, duration=50)
    with pytest.raises(psycopg.errors.RaiseException, match="bad_trim"):
        _edit(conn, user, clip, {"end": 55})
    assert _edit(conn, user, clip, {"end": 50}) == 1


@pytest.mark.parametrize(
    "edit",
    [
        {},
        {"title": "x"},
        {"words": [{"text": "", "start": 1, "end": 2}]},
        {"words": [{"text": "a", "start": "1", "end": 2}]},
        {"hook": "x" * 121},
        {"style": {"template": "neon"}},
        {"style": {"wordsPerCaption": 9}},
        {"style": {"hookTitle": "yes"}},
        {"start": "5"},
    ],
)
def test_malformed_edits_are_refused(conn, ready_clip, edit):
    user, [clip] = ready_clip(buyer=True)
    with pytest.raises(psycopg.errors.RaiseException, match="bad_edit"):
        _edit(conn, user, clip, edit)


def test_one_edit_at_a_time_and_only_on_your_own_ready_clips(conn, ready_clip, make_user):
    user, [clip] = ready_clip()
    _edit(conn, user, clip, {"hook": "a"})
    with pytest.raises(psycopg.errors.RaiseException, match="edit_in_progress"):
        _edit(conn, user, clip, {"hook": "b"})
    with pytest.raises(psycopg.errors.RaiseException, match="not_found"):
        _edit(conn, make_user(), clip, {"hook": "c"})
    conn.execute(
        "update public.projects set status = 'expired' "
        "where id = (select project_id from public.clips where id = %s)",
        (clip,),
    )
    conn.execute("update public.jobs set status = 'succeeded' where clip_id = %s", (clip,))
    with pytest.raises(psycopg.errors.RaiseException, match="not_ready"):
        _edit(conn, user, clip, {"hook": "d"})


def test_style_can_go_to_every_clip_of_the_project(conn, ready_clip):
    user, clips = ready_clip(buyer=True, clips=3)
    _edit(conn, user, clips[2], {"hook": "busy"})
    style = {"template": "ali", "position": "top"}
    # The clip already being redone is left alone.
    assert _edit(conn, user, clips[0], {"style": style}, to_all=True) == 2
    assert _jobs(conn, clips[1])[0]["payload"] == {"style": style}
    assert len(_jobs(conn, clips[2])) == 1


def test_users_cannot_write_jobs_or_clips_directly(conn, ready_clip):
    user, [clip] = ready_clip()
    _as(conn, user)
    try:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("update public.clips set hook_text = 'x' where id = %s", (clip,))
    finally:
        conn.execute("reset role")


def test_rerender_goes_first_in_its_lane_and_leaves_the_project_ready(
    conn, ready_clip, make_project
):
    user, [clip] = ready_clip()
    waiting = make_project(user)
    conn.execute(
        "update public.jobs set run_after = now() - interval '1 hour' where project_id = %s",
        (waiting,),
    )
    _edit(conn, user, clip, {"hook": "a"})
    q = JobQueue(conn, "w1")
    job = q.claim()
    assert (job.kind, job.clip_id, job.payload) == ("rerender_clip", clip, {"hook": "a"})
    project = conn.execute(
        "select status from public.projects where id = %s", (job.project_id,)
    ).fetchone()
    assert project["status"] == "ready"

    # Failing for good does not fail (or refund) the project.
    conn.execute("update public.jobs set attempt = max_attempts where id = %s", (job.id,))
    q.fail(job, "download blocked")
    row = conn.execute(
        "select p.status, p.credits_charged, pr.credits_remaining from public.projects p "
        "join public.profiles pr on pr.id = p.user_id where p.id = %s",
        (job.project_id,),
    ).fetchone()
    assert row["status"] == "ready"
    assert (
        conn.execute(
            "select count(*) as n from public.credit_ledger where reason = 'refund_failed'"
        ).fetchone()["n"]
        == 0
    )


def test_queue_position_counts_whole_videos_only(conn, ready_clip, make_project):
    user, [clip] = ready_clip()
    _edit(conn, user, clip, {"hook": "a"})
    waiting = make_project(user)
    assert _position(conn, user, waiting)["place"] == 1


def _fake_rerender(seen):
    def run(options, clip, edit, work, report, *, current_video, terms):
        seen.append((clip.start, clip.hook_text, edit.hook, terms))
        work.mkdir(parents=True, exist_ok=True)
        video, thumb = work / "clip-01.mp4", work / "clip-01.jpg"
        video.write_bytes(b"v")
        thumb.write_bytes(b"j")
        return Rerendered(
            12.0, 38.0, edit.hook, [Word("Matheus", 12.2, 12.6)],
            {"template": "box", "teaser": None}, video, thumb,
        )  # fmt: skip

    return run


def test_worker_saves_the_new_clip_in_place(conn, ready_clip, tmp_path):
    user, [clip] = ready_clip(buyer=True)
    _as(conn, user)
    conn.execute("select public.save_term('Mateus Kunya', 'Matheus Cunha')")
    conn.execute("reset role")
    _edit(conn, user, clip, {"hook": "Baru", "start": 12, "end": 38})
    q = JobQueue(conn, "w1")
    seen = []
    worker_main.process_edit(q, q.claim(), run=_fake_rerender(seen), work_root=tmp_path)

    assert seen == [(10.0, "Hook", "Baru", [("Mateus Kunya", "Matheus Cunha")])]
    row = conn.execute(
        "select start_seconds, end_seconds, hook_text, caption_words, render, video_path, "
        "edited_at is not null as edited from public.clips where id = %s",
        (clip,),
    ).fetchone()
    assert row == {
        "start_seconds": 12, "end_seconds": 38, "hook_text": "Baru",
        "caption_words": [{"text": "Matheus", "start": 12.2, "end": 12.6}],
        "render": {"template": "box", "teaser": None},
        "video_path": str(tmp_path / f"edit-{clip}" / "clip-01.mp4"), "edited": True,
    }  # fmt: skip
    assert _jobs(conn, clip)[0]["status"] == "succeeded"


def test_worker_gives_up_on_an_invalid_edit(conn, ready_clip, tmp_path):
    user, [clip] = ready_clip()
    _edit(conn, user, clip, {"hook": "a"})
    conn.execute("update public.jobs set payload = '{\"start\": -5}' where clip_id = %s", (clip,))
    q = JobQueue(conn, "w1")
    worker_main.process(q, q.claim(), work_root=tmp_path)
    job = conn.execute(
        "select status, error from public.jobs where clip_id = %s", (clip,)
    ).fetchone()
    assert job["status"] == "failed" and job["error"].startswith("invalid edit")


def test_worker_retries_a_failed_rerender(conn, ready_clip, tmp_path):
    user, [clip] = ready_clip()
    _edit(conn, user, clip, {"hook": "a"})

    def broken(*args, **kwargs):
        raise RuntimeError("Sign in to confirm you're not a bot")

    q = JobQueue(conn, "w1")
    worker_main.process_edit(q, q.claim(), run=broken, work_root=tmp_path)
    assert _jobs(conn, clip)[0]["status"] == "queued"


# ---------------------------------------------------------------------------
# name dictionary
# ---------------------------------------------------------------------------


def _term(conn, user, wrong, correct):
    _as(conn, user)
    try:
        return conn.execute("select public.save_term(%s, %s) as id", (wrong, correct)).fetchone()[
            "id"
        ]
    finally:
        conn.execute("reset role")


def _terms(conn, user):
    _as(conn, user)
    try:
        return [(r["wrong"], r["correct"]) for r in conn.execute(
            "select wrong, correct from public.user_terms order by id").fetchall()]  # fmt: skip
    finally:
        conn.execute("reset role")


def test_buyers_keep_a_name_dictionary(conn, make_user):
    buyer, other = make_user(), make_user()
    _buy(conn, buyer)
    _buy(conn, other)
    first = _term(conn, buyer, "  Mateus   Kunya ", "Matheus Cunha")
    # The same wrong spelling, any case, updates the entry.
    assert _term(conn, buyer, "mateus kunya", "Matheus  Cunha") == first
    _term(conn, buyer, "tirta cipeng", "Tirta Cipeng")
    _term(conn, other, "sofis", "Sofish")
    assert _terms(conn, buyer) == [
        ("Mateus Kunya", "Matheus Cunha"),
        ("tirta cipeng", "Tirta Cipeng"),
    ]
    assert JobQueue(conn, "w1").terms(other) == [("sofis", "Sofish")]

    _as(conn, other)
    conn.execute("select public.delete_term(%s)", (first,))  # not theirs: nothing happens
    conn.execute("reset role")
    _as(conn, buyer)
    conn.execute("select public.delete_term(%s)", (first,))
    conn.execute("reset role")
    assert _terms(conn, buyer) == [("tirta cipeng", "Tirta Cipeng")]


def test_dictionary_is_for_buyers_and_checked(conn, make_user):
    free, buyer = make_user(), make_user()
    _buy(conn, buyer)
    with pytest.raises(psycopg.errors.RaiseException, match="buyers_only"):
        _term(conn, free, "a", "b")
    for wrong, correct in (("", "x"), ("x", "x"), ("x" * 61, "y")):
        with pytest.raises(psycopg.errors.RaiseException, match="bad_term"):
            _term(conn, buyer, wrong, correct)
    _as(conn, buyer)
    try:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("insert into public.user_terms (user_id, wrong, correct) "
                         "values (auth.uid(), 'a', 'b')")  # fmt: skip
    finally:
        conn.execute("reset role")


def test_worker_hands_the_dictionary_to_the_pipeline(conn, make_user, make_project, tmp_path):
    from .test_queue import fake_run

    user = make_user()
    _buy(conn, user)
    _term(conn, user, "sofis", "Sofish")
    make_project(user)
    seen = []

    def spy(options, report, work, terms=()):
        seen.append(terms)
        return fake_run(options, report, work)

    q = JobQueue(conn, "w1")
    worker_main.process(q, q.claim(), run=spy, work_root=tmp_path)
    assert seen == [[("sofis", "Sofish")]]


def test_local_paths_feed_the_current_video(conn, ready_clip, tmp_path):
    user, [clip] = ready_clip()
    local = tmp_path / "clip-01.mp4"
    local.write_bytes(b"v")
    conn.execute("update public.clips set video_path = %s where id = %s", (str(local), clip))
    _edit(conn, user, clip, {"hook": "a"})
    got = []

    def run(options, clip_row, edit, work, report, *, current_video, terms):
        got.append(current_video())
        return _fake_rerender([])(options, clip_row, edit, work, report, current_video=None,
                                  terms=terms)  # fmt: skip

    q = JobQueue(conn, "w1")
    worker_main.process_edit(q, q.claim(), run=run, work_root=tmp_path / "w")
    assert got == [Path(local)]
