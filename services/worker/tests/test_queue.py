import psycopg
import pytest

from clipper_worker import main as worker_main
from clipper_worker.queue import JobQueue


def project_status(conn, project_id):
    return conn.execute(
        "select status, error from public.projects where id = %s", (project_id,)
    ).fetchone()


def test_new_user_gets_profile_with_free_credits(conn, make_user):
    uid = make_user()
    row = conn.execute("select plan, credits_remaining from public.profiles where id = %s", (uid,))
    assert row.fetchone() == {"plan": "free", "credits_remaining": 30}


def test_project_insert_enqueues_job_and_claim_marks_processing(conn, make_project):
    pid = make_project()
    q = JobQueue(conn, "w1")

    job = q.claim()
    assert job is not None and job.project_id == pid and job.attempt == 1
    assert job.options["youtubeUrl"].startswith("https://youtu.be/")
    assert project_status(conn, pid)["status"] == "processing"
    assert q.claim() is None, "a running job must not be claimed twice"


def test_success_marks_project_ready(conn, make_project):
    pid = make_project()
    q = JobQueue(conn, "w1")
    job = q.claim()
    q.progress(job, "render", 0.5)
    assert conn.execute("select stage, progress from public.jobs").fetchone() == {
        "stage": "render",
        "progress": 0.5,
    }
    q.succeed(job)
    assert project_status(conn, pid)["status"] == "ready"


def test_failure_retries_with_backoff_then_fails_project(conn, make_project):
    pid = make_project()
    q = JobQueue(conn, "w1")

    for attempt in (1, 2, 3):
        job = q.claim()
        assert job is not None and job.attempt == attempt
        q.fail(job, "boom")
        # Skip the backoff delay so the next claim can run now.
        conn.execute("update public.jobs set run_after = now()")

    assert q.claim() is None
    assert project_status(conn, pid) == {"status": "failed", "error": "boom"}


def test_only_lock_holder_can_finish(conn, make_project):
    make_project()
    job = JobQueue(conn, "w1").claim()
    with pytest.raises(psycopg.errors.RaiseException):
        JobQueue(conn, "w2").succeed(job)


def test_stale_running_job_is_reclaimed(conn, make_project):
    make_project()
    JobQueue(conn, "crashed").claim()
    conn.execute("update public.jobs set locked_at = now() - interval '1 hour'")
    job = JobQueue(conn, "w2").claim()
    assert job is not None and job.attempt == 2


def fake_run(options, report, work):
    from pathlib import Path

    from clipper_worker.engine.highlights import Highlight
    from clipper_worker.engine.pipeline import PipelineResult, RenderedClip, Source
    from clipper_worker.engine.transcript import Word

    for stage in ("download", "transcribe", "analyze", "render"):
        report(stage, 0.5)
    words = [Word("hi", 10.0, 10.5)]
    source = Source(Path("src.mp4"), 0.0, words, "My Video", "en", "arj7oStGLkU", 600.0, None)
    h = Highlight(10.0, 40.0, "Title", "Hook", "Desc", 80, "Reason")
    return PipelineResult(source, [RenderedClip(0, h, Path("c.mp4"), Path("c.jpg"), words)])


def test_worker_process_saves_clips_and_metadata(conn, make_project, tmp_path):
    pid = make_project()
    q = JobQueue(conn, "w1")
    worker_main.process(q, q.claim(), run=fake_run, work_root=tmp_path)
    project = conn.execute(
        "select status, title, youtube_id, duration_seconds from public.projects where id = %s",
        (pid,),
    ).fetchone()
    assert project == {
        "status": "ready", "title": "My Video", "youtube_id": "arj7oStGLkU",
        "duration_seconds": 600,
    }  # fmt: skip
    clips = conn.execute(
        "select position, start_seconds, end_seconds, hook_text, virality_score, caption_words "
        "from public.clips where project_id = %s",
        (pid,),
    ).fetchall()
    assert clips == [
        {"position": 0, "start_seconds": 10.0, "end_seconds": 40.0, "hook_text": "Hook",
         "virality_score": 80.0, "caption_words": [{"text": "hi", "start": 10.0, "end": 10.5}]}
    ]  # fmt: skip


def test_worker_records_pipeline_errors_for_retry(conn, make_project, tmp_path):
    pid = make_project()
    q = JobQueue(conn, "w1")

    def broken(options, report, work):
        raise RuntimeError("download blocked")

    worker_main.process(q, q.claim(), run=broken, work_root=tmp_path)
    job = conn.execute("select status, error from public.jobs").fetchone()
    assert job == {"status": "queued", "error": "RuntimeError: download blocked"}
    assert project_status(conn, pid)["status"] == "processing"


def test_worker_fails_invalid_options_without_retry(conn, make_project):
    pid = make_project(options={"youtubeUrl": "https://vimeo.com/1", "timeframe": {}})
    q = JobQueue(conn, "w1")
    worker_main.process(q, q.claim())
    status = project_status(conn, pid)
    assert status["status"] == "failed"
    assert status["error"].startswith("invalid options")


def test_rls_users_only_see_their_own_projects(conn, make_user, make_project):
    alice, bob = make_user(), make_user()
    alice_project = make_project(user_id=alice)
    make_project(user_id=bob)

    conn.execute("set role authenticated")
    try:
        conn.execute("select set_config('request.jwt.claim.sub', %s, false)", (str(alice),))
        rows = conn.execute("select id from public.projects").fetchall()
        assert [r["id"] for r in rows] == [alice_project]
        assert len(conn.execute("select id from public.jobs").fetchall()) == 1

        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("select * from public.claim_job('sneaky')")
    finally:
        conn.execute("reset role")


def test_rls_blocks_creating_projects_for_someone_else(conn, make_user):
    alice, bob = make_user(), make_user()
    conn.execute("set role authenticated")
    try:
        conn.execute("select set_config('request.jwt.claim.sub', %s, false)", (str(alice),))
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute(
                "insert into public.projects (user_id, youtube_url, options) "
                "values (%s, 'x', '{}')",
                (bob,),
            )
    finally:
        conn.execute("reset role")
