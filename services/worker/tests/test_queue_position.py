from clipper_worker.queue import JobQueue


def _as(conn, uid):
    conn.execute("set role authenticated")
    conn.execute("select set_config('request.jwt.claim.sub', %s, false)", (str(uid),))


def _position(conn, uid, project_id):
    _as(conn, uid)
    try:
        return conn.execute("select * from public.queue_position(%s)", (project_id,)).fetchone()
    finally:
        conn.execute("reset role")


def _owner(conn, project_id):
    return conn.execute(
        "select user_id from public.projects where id = %s", (project_id,)
    ).fetchone()["user_id"]


def test_position_counts_the_jobs_ahead(conn, make_project):
    first, _, third = make_project(), make_project(), make_project()
    assert _position(conn, _owner(conn, first), first)["place"] == 1
    pos = _position(conn, _owner(conn, third), third)
    # No history yet: 10 minutes per job, one worker, the running half done.
    assert (pos["place"], pos["workers"], pos["avg_seconds"]) == (3, 1, 600)
    assert pos["eta_seconds"] == 600 * 2.5


def test_running_jobs_count_as_workers_and_move_the_line(conn, make_project):
    projects = [make_project() for _ in range(5)]
    queue_a, queue_b = JobQueue(conn, "w-a"), JobQueue(conn, "w-b")
    queue_a.claim()
    queue_b.claim()
    last = projects[-1]
    pos = _position(conn, _owner(conn, last), last)
    # Two running, two queued ahead: one round of two, then this one.
    assert (pos["place"], pos["workers"]) == (3, 2)
    assert pos["eta_seconds"] == 600 * 1.5


def test_average_comes_from_jobs_finished_today(conn, make_project):
    make_project()  # the job that finishes
    waiting = make_project()
    queue = JobQueue(conn, "w-a")
    job = queue.claim()
    conn.execute(
        "update public.jobs set started_at = now() - interval '4 minutes' where id = %s",
        (job.id,),
    )
    queue.succeed(job)
    pos = _position(conn, _owner(conn, waiting), waiting)
    assert 238 <= pos["avg_seconds"] <= 242


def test_only_the_owner_sees_a_queued_project(conn, make_project, make_user):
    project = make_project()
    assert _position(conn, make_user(), project) is None
    JobQueue(conn, "w-a").claim()
    assert _position(conn, _owner(conn, project), project) is None
