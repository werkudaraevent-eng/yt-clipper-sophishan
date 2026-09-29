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


def test_worker_only_processes_the_minutes_that_were_paid_for(conn, make_user, tmp_path):
    # The client reports the video length, and the charge trusts it. A user who
    # claims a one-minute video but asks for the first hour pays 1 credit; the
    # worker must then cut only that minute, not the hour.
    uid = make_user()
    url = "https://youtu.be/arj7oStGLkU"
    options = {"youtubeUrl": url, "timeframe": {"start": 30, "end": 3600}}
    conn.execute(
        "insert into public.projects (user_id, youtube_url, duration_seconds, options) "
        "values (%s, %s, 60, %s)",
        (uid, url, psycopg.types.json.Jsonb(options)),
    )
    seen = []

    def spy(options, report, work):
        seen.append((options.timeframe.start, options.timeframe.end))
        return fake_run(options, report, work)

    q = JobQueue(conn, "w1")
    worker_main.process(q, q.claim(), run=spy, work_root=tmp_path)
    assert seen == [(30, 90)]


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


# --- credits -----------------------------------------------------------------


def balance(conn, uid):
    row = conn.execute(
        "select p.credits_remaining, coalesce(sum(l.delta), 0)::int as ledger "
        "from public.profiles p left join public.credit_ledger l on l.user_id = p.id "
        "where p.id = %s group by p.credits_remaining",
        (uid,),
    ).fetchone()
    assert row["credits_remaining"] == row["ledger"], "ledger must sum to the balance"
    return row["credits_remaining"]


def test_project_charges_one_credit_per_started_minute(conn, make_user, make_project):
    uid = make_user()
    pid = make_project(
        user_id=uid,
        options={"youtubeUrl": "https://youtu.be/arj7oStGLkU",
                 "timeframe": {"start": 30, "end": 301}},
    )  # fmt: skip
    charged = conn.execute("select credits_charged from public.projects where id = %s", (pid,))
    assert charged.fetchone()["credits_charged"] == 5
    assert balance(conn, uid) == 25


def test_credit_cost_uses_known_duration(conn):
    cost = conn.execute(
        "select public.project_credit_cost(%s, 120) as c",
        (psycopg.types.json.Jsonb({"timeframe": {"start": 0, "end": 3600}}),),
    ).fetchone()["c"]
    assert cost == 2


def test_insufficient_credits_blocks_project(conn, make_user, make_project):
    uid = make_user()
    with pytest.raises(psycopg.errors.RaiseException, match="insufficient_credits"):
        make_project(
            user_id=uid,
            options={"youtubeUrl": "https://youtu.be/arj7oStGLkU",
                     "timeframe": {"start": 0, "end": 3600}},
        )  # fmt: skip
    assert balance(conn, uid) == 30
    assert conn.execute("select count(*) as n from public.projects").fetchone()["n"] == 0


def test_final_failure_refunds_credits_once(conn, make_user, make_project):
    uid = make_user()
    make_project(user_id=uid)
    assert balance(conn, uid) == 20
    q = JobQueue(conn, "w1")
    for _ in range(3):
        q.fail(q.claim(), "boom")
        conn.execute("update public.jobs set run_after = now()")
    assert balance(conn, uid) == 30
    conn.execute("update public.projects set status = 'failed', error = 'again'")
    assert balance(conn, uid) == 30


def test_users_cannot_top_up_their_own_credits(conn, make_user):
    uid = make_user()
    conn.execute("set role authenticated")
    try:
        conn.execute("select set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
        conn.execute("update public.profiles set ui_language = 'id' where id = %s", (uid,))
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute(
                "update public.profiles set credits_remaining = 9999 where id = %s", (uid,)
            )
    finally:
        conn.execute("reset role")


# --- expiry ------------------------------------------------------------------


def test_expiry_marks_projects_and_returns_clip_files(conn, make_project, tmp_path):
    old, fresh = make_project(), make_project()
    q = JobQueue(conn, "w1")
    for _ in range(2):
        worker_main.process(q, q.claim(), run=fake_run, work_root=tmp_path)
    conn.execute(
        "update public.projects set expires_at = now() - interval '1 day' where id = %s", (old,)
    )
    assert sorted(q.expire_projects()) == ["c.jpg", "c.mp4"]
    assert project_status(conn, old)["status"] == "expired"
    assert project_status(conn, fresh)["status"] == "ready"
    left = conn.execute("select project_id from public.clips").fetchall()
    assert [r["project_id"] for r in left] == [fresh]
    assert q.expire_projects() == []


def test_expiry_cancels_queued_job_and_skips_running(conn, make_project):
    queued, running = make_project(), make_project()
    conn.execute("update public.projects set expires_at = now() - interval '1 day'")
    conn.execute(
        "update public.jobs set run_after = now() + interval '1 hour' where project_id = %s",
        (queued,),
    )
    JobQueue(conn, "w1").claim()  # takes `running`
    JobQueue(conn, "w1").expire_projects()
    assert project_status(conn, queued)["status"] == "expired"
    assert project_status(conn, running)["status"] == "processing"
    job = conn.execute("select status from public.jobs where project_id = %s", (queued,))
    assert job.fetchone()["status"] == "failed"


def test_worker_expire_deletes_remote_and_local_files(tmp_path):
    local = tmp_path / "clip.mp4"
    local.write_bytes(b"x")

    class Q:
        def expire_projects(self):
            return ["u/p/clip-01.mp4", str(local)]

    class S:
        deleted = None

        def delete(self, paths):
            S.deleted = paths

    assert worker_main.expire(Q(), S()) == 2
    assert S.deleted == ["u/p/clip-01.mp4"] and not local.exists()


# --- admin credits -----------------------------------------------------------


def _as(conn, uid):
    conn.execute("set role authenticated")
    conn.execute("select set_config('request.jwt.claim.sub', %s, false)", (str(uid),))


def test_admin_can_find_user_and_adjust_credits(conn, make_user):
    admin, user = make_user("admin@example.com"), make_user("buyer@example.com")
    conn.execute("update public.profiles set is_admin = true where id = %s", (admin,))
    email = conn.execute("select email from auth.users where id = %s", (user,)).fetchone()["email"]
    _as(conn, admin)
    try:
        found = conn.execute(
            "select * from public.admin_find_user(%s)", (email.upper(),)
        ).fetchall()
        assert [(r["id"], r["credits_remaining"]) for r in found] == [(user, 30)]
        new = conn.execute(
            "select public.admin_adjust_credits(%s, 100, 'paid via transfer') as b", (user,)
        ).fetchone()["b"]
        assert new == 130
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute("select public.admin_adjust_credits(%s, -500, 'too much')", (user,))
    finally:
        conn.execute("reset role")
    assert balance(conn, user) == 130
    ledger = conn.execute(
        "select delta, reason from public.credit_ledger where user_id = %s order by id", (user,)
    ).fetchall()
    assert ledger[-1]["delta"] == 100
    assert ledger[-1]["reason"].startswith("admin: paid via transfer")


def test_non_admins_cannot_use_admin_functions(conn, make_user):
    uid = make_user()
    _as(conn, uid)
    try:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("select * from public.admin_find_user('x@example.com')")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("select public.admin_adjust_credits(%s, 100, 'me')", (uid,))
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("update public.profiles set is_admin = true where id = %s", (uid,))
    finally:
        conn.execute("reset role")
    assert balance(conn, uid) == 30
