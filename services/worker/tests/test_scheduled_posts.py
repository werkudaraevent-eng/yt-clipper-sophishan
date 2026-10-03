import psycopg
import pytest

TOKEN = "test-scheduler-token"


def _as(conn, uid):
    conn.execute("set role authenticated")
    conn.execute("select set_config('request.jwt.claim.sub', %s, false)", (str(uid),))


@pytest.fixture
def scheduler_token(conn):
    conn.execute(
        "insert into private.settings (key, value) "
        "values ('scheduler_token_sha256', encode(extensions.digest(%s, 'sha256'), 'hex')) "
        "on conflict (key) do update set value = excluded.value",
        (TOKEN,),
    )
    return TOKEN


@pytest.fixture
def clip(conn, make_user, make_project):
    """A ready clip whose owner has a YouTube connection; returns (user, clip)."""

    def _make(user=None, connected=True):
        user = user or make_user()
        project = make_project(user)
        conn.execute("update public.projects set status = 'ready' where id = %s", (project,))
        clip_id = conn.execute(
            "insert into public.clips "
            "(project_id, position, start_seconds, end_seconds, video_path) "
            "values (%s, 0, 1, 20, %s) returning id",
            (project, f"{user}/{project}/clip-01.mp4"),
        ).fetchone()["id"]
        if connected:
            conn.execute(
                "insert into public.youtube_connections (user_id, refresh_token_enc) "
                "values (%s, 'enc')",
                (user,),
            )
        return user, clip_id

    return _make


def _schedule(conn, user, clip_id, at="now() + interval '1 day'", token="tok"):
    _as(conn, user)
    try:
        return conn.execute(
            f"select public.schedule_clip_post(%s, {at}, 'public', 'Title #Shorts', 'Desc', %s) "
            "as id",
            (clip_id, token),
        ).fetchone()["id"]
    finally:
        conn.execute("reset role")


def _post(conn, post_id):
    return conn.execute("select * from public.clip_posts where id = %s", (post_id,)).fetchone()


def _claim(conn, token=TOKEN):
    conn.execute("set role anon")
    try:
        return conn.execute("select * from public.claim_due_clip_post(%s)", (token,)).fetchall()
    finally:
        conn.execute("reset role")


def _finish(conn, post_id, status, external_id=None, code=None, channel=None):
    conn.execute("set role anon")
    try:
        conn.execute(
            "select public.finish_clip_post(%s, %s, %s, %s, %s, %s, %s)",
            (TOKEN, post_id, status, external_id, code, code and f"{code} detail", channel),
        )
    finally:
        conn.execute("reset role")


def _make_due(conn, post_id):
    conn.execute(
        "update public.clip_posts set scheduled_at = now() - interval '1 minute' where id = %s",
        (post_id,),
    )


def test_scheduling_queues_the_clip_and_rescheduling_moves_it(conn, clip):
    user, clip_id = clip()
    first = _schedule(conn, user, clip_id)
    row = _post(conn, first)
    assert (row["status"], row["title"], row["file_token"]) == ("scheduled", "Title #Shorts", "tok")

    again = _schedule(conn, user, clip_id, at="now() + interval '2 days'", token="tok2")
    assert again == first
    row = _post(conn, first)
    assert row["file_token"] == "tok2"
    assert conn.execute("select count(*) as n from public.clip_posts").fetchone()["n"] == 1


def test_scheduling_checks_owner_connection_and_time(conn, clip, make_user):
    user, clip_id = clip()
    with pytest.raises(psycopg.errors.NoDataFound):
        _schedule(conn, make_user("other@example.com"), clip_id)
    with pytest.raises(psycopg.errors.InvalidParameterValue, match="bad_time"):
        _schedule(conn, user, clip_id, at="now() - interval '1 hour'")
    with pytest.raises(psycopg.errors.InvalidParameterValue, match="bad_time"):
        _schedule(conn, user, clip_id, at="now() + interval '31 days'")
    conn.execute(
        "update public.projects set expires_at = now() + interval '2 hours' "
        "where id = (select project_id from public.clips where id = %s)",
        (clip_id,),
    )
    with pytest.raises(psycopg.errors.InvalidParameterValue, match="bad_time"):
        _schedule(conn, user, clip_id, at="now() + interval '90 minutes'")

    lonely, lonely_clip = clip(connected=False)
    with pytest.raises(psycopg.errors.RaiseException, match="reconnect"):
        _schedule(conn, lonely, lonely_clip)


def test_a_posted_clip_cannot_be_scheduled(conn, clip):
    user, clip_id = clip()
    conn.execute(
        "insert into public.clip_posts (clip_id, user_id, status, privacy, external_id) "
        "values (%s, %s, 'published', 'public', 'abc')",
        (clip_id, user),
    )
    with pytest.raises(psycopg.errors.RaiseException, match="already_posted"):
        _schedule(conn, user, clip_id)


def test_owner_cancels_but_others_cannot(conn, clip, make_user):
    user, clip_id = clip()
    post = _schedule(conn, user, clip_id)
    _as(conn, make_user("other@example.com"))
    try:
        with pytest.raises(psycopg.errors.NoDataFound):
            conn.execute("select public.cancel_clip_post(%s)", (post,))
    finally:
        conn.execute("reset role")
    _as(conn, user)
    try:
        conn.execute("select public.cancel_clip_post(%s)", (post,))
    finally:
        conn.execute("reset role")
    assert _post(conn, post)["status"] == "canceled"


def test_cron_functions_need_the_token(conn, scheduler_token):
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        _claim(conn, "wrong")
    conn.execute("set role anon")
    try:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("select * from public.due_clip_post_stats(null, 10)")
    finally:
        conn.execute("reset role")


def test_claim_takes_due_posts_once_with_what_the_upload_needs(conn, clip, scheduler_token):
    user, clip_id = clip()
    later_user, later_clip = clip()
    post = _schedule(conn, user, clip_id)
    _schedule(conn, later_user, later_clip)
    assert _claim(conn) == []

    _make_due(conn, post)
    [claimed] = _claim(conn)
    assert claimed["post_id"] == post
    assert claimed["video_path"].endswith("/clip-01.mp4")
    assert (claimed["file_token"], claimed["refresh_token_enc"], claimed["attempts"]) == (
        "tok",
        "enc",
        1,
    )
    assert _post(conn, post)["status"] == "uploading"
    assert _claim(conn) == []


def test_finish_publishes_and_names_the_channel(conn, clip, scheduler_token):
    user, clip_id = clip()
    post = _schedule(conn, user, clip_id)
    _make_due(conn, post)
    _claim(conn)
    _finish(conn, post, "published", external_id="yt123", channel="Alice TV")
    row = _post(conn, post)
    assert (row["status"], row["external_id"]) == ("published", "yt123")
    assert row["published_at"] is not None
    channel = conn.execute(
        "select channel_title from public.youtube_connections where user_id = %s", (user,)
    ).fetchone()["channel_title"]
    assert channel == "Alice TV"


def test_retry_requeues_and_reconnect_drops_the_token(conn, clip, scheduler_token):
    user, clip_id = clip()
    post = _schedule(conn, user, clip_id)
    _make_due(conn, post)
    _claim(conn)
    _finish(conn, post, "retry", code="failed")
    row = _post(conn, post)
    assert row["status"] == "scheduled" and row["error_code"] == "failed"

    _make_due(conn, post)
    _claim(conn)
    _finish(conn, post, "failed", code="reconnect")
    assert _post(conn, post)["status"] == "failed"
    gone = conn.execute(
        "select count(*) as n from public.youtube_connections where user_id = %s", (user,)
    ).fetchone()["n"]
    assert gone == 0


def test_stuck_uploads_fail_and_posted_clips_leave_the_queue(conn, clip, scheduler_token):
    user, clip_id = clip()
    post = _schedule(conn, user, clip_id)
    _make_due(conn, post)
    _claim(conn)
    conn.execute(
        "update public.clip_posts set updated_at = now() - interval '20 minutes' where id = %s",
        (post,),
    )
    _claim(conn)
    row = _post(conn, post)
    assert (row["status"], row["error_code"]) == ("failed", "timeout")

    other_user, other_clip = clip()
    queued = _schedule(conn, other_user, other_clip)
    conn.execute(
        "insert into public.clip_posts (clip_id, user_id, status, privacy, external_id) "
        "values (%s, %s, 'published', 'public', 'abc')",
        (other_clip, other_user),
    )
    _make_due(conn, queued)
    assert _claim(conn) == []
    assert _post(conn, queued)["status"] == "canceled"


def test_rescheduling_a_failed_post_reuses_it(conn, clip, scheduler_token):
    user, clip_id = clip()
    post = _schedule(conn, user, clip_id)
    _make_due(conn, post)
    _claim(conn)
    _finish(conn, post, "failed", code="quota")
    again = _schedule(conn, user, clip_id)
    assert again == post
    row = _post(conn, post)
    assert (row["status"], row["error_code"], row["attempts"]) == ("scheduled", None, 0)


def test_view_counts_are_collected_a_day_after_posting(conn, clip, scheduler_token):
    user, clip_id = clip()
    post = conn.execute(
        "insert into public.clip_posts "
        "(clip_id, user_id, status, privacy, external_id, published_at) "
        "values (%s, %s, 'published', 'public', 'yt1', now() - interval '30 hours') returning id",
        (clip_id, user),
    ).fetchone()["id"]
    conn.execute("set role anon")
    try:
        due = conn.execute("select * from public.due_clip_post_stats(%s, 10)", (TOKEN,)).fetchall()
        assert due == [{"post_id": post, "external_id": "yt1"}]
        # Handed out once an hour at most.
        assert (
            conn.execute("select * from public.due_clip_post_stats(%s, 10)", (TOKEN,)).fetchall()
            == []
        )
        conn.execute("select public.save_clip_post_views(%s, %s, %s)", (TOKEN, [post], [1236]))
    finally:
        conn.execute("reset role")
    assert _post(conn, post)["views_24h"] == 1236


def test_users_cannot_queue_posts_directly(conn, clip, scheduler_token):
    user, clip_id = clip()
    _as(conn, user)
    try:
        post = conn.execute(
            "insert into public.clip_posts (clip_id, user_id, privacy, title) "
            "values (%s, %s, 'public', 'Now') returning id",
            (clip_id, user),
        ).fetchone()["id"]
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute(
                "insert into public.clip_posts "
                "(clip_id, user_id, privacy, scheduled_at, file_token) "
                "values (%s, %s, 'public', now(), 'forged')",
                (clip_id, user),
            )
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("update public.clip_posts set status = 'scheduled' where id = %s", (post,))
        conn.execute("update public.clip_posts set status = 'failed' where id = %s", (post,))
    finally:
        conn.execute("reset role")
    assert _post(conn, post)["status"] == "failed"
    conn.execute("set role anon")
    try:
        assert (
            conn.execute("select * from public.claim_due_clip_post(%s)", (TOKEN,)).fetchall() == []
        )
    finally:
        conn.execute("reset role")


def test_users_change_their_rhythm_but_not_their_credits(conn, make_user):
    user = make_user()
    _as(conn, user)
    try:
        conn.execute(
            "update public.profiles set post_per_day = 2, post_peak_only = false where id = %s",
            (user,),
        )
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute(
                "update public.profiles set credits_remaining = 999 where id = %s", (user,)
            )
    finally:
        conn.execute("reset role")
    row = conn.execute(
        "select post_per_day, post_peak_only from public.profiles where id = %s", (user,)
    ).fetchone()
    assert row == {"post_per_day": 2, "post_peak_only": False}
