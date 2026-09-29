import psycopg
import pytest


def _as(conn, uid):
    conn.execute("set role authenticated")
    conn.execute("select set_config('request.jwt.claim.sub', %s, false)", (str(uid),))


def _clip(conn, project_id):
    return conn.execute(
        "insert into public.clips (project_id, position, start_seconds, end_seconds) "
        "values (%s, 0, 1, 20) returning id",
        (project_id,),
    ).fetchone()["id"]


def test_users_see_their_connection_but_not_the_token_column(conn, make_user):
    alice, bob = make_user("alice@example.com"), make_user("bob@example.com")
    _as(conn, alice)
    try:
        conn.execute("select public.save_youtube_connection('a@gmail.com', 'enc-a')")
        conn.execute("select public.set_youtube_channel_title('Alice TV')")
        row = conn.execute(
            "select google_email, channel_title from public.youtube_connections"
        ).fetchone()
        assert row == {"google_email": "a@gmail.com", "channel_title": "Alice TV"}
        assert conn.execute("select public.youtube_refresh_token() as t").fetchone()["t"] == "enc-a"
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("select refresh_token_enc from public.youtube_connections")
    finally:
        conn.execute("reset role")

    _as(conn, bob)
    try:
        assert (
            conn.execute("select count(*) as n from public.youtube_connections").fetchone()["n"]
            == 0
        )
        assert conn.execute("select public.youtube_refresh_token() as t").fetchone()["t"] is None
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute(
                "update public.youtube_connections set refresh_token_enc = 'x' where user_id = %s",
                (alice,),
            )
    finally:
        conn.execute("reset role")


def test_reconnecting_replaces_the_token_and_disconnect_deletes_it(conn, make_user):
    uid = make_user()
    _as(conn, uid)
    try:
        conn.execute("select public.save_youtube_connection('old@gmail.com', 'enc-1')")
        conn.execute("select public.save_youtube_connection('new@gmail.com', 'enc-2')")
        assert conn.execute("select public.youtube_refresh_token() as t").fetchone()["t"] == "enc-2"
        conn.execute("delete from public.youtube_connections where user_id = %s", (uid,))
        assert conn.execute("select public.youtube_refresh_token() as t").fetchone()["t"] is None
    finally:
        conn.execute("reset role")


def test_users_can_only_post_their_own_clips(conn, make_user, make_project):
    alice, bob = make_user("alice@example.com"), make_user("bob@example.com")
    alice_clip = _clip(conn, make_project(alice))
    bob_clip = _clip(conn, make_project(bob))
    _as(conn, alice)
    try:
        post = conn.execute(
            "insert into public.clip_posts (clip_id, user_id, privacy) "
            "values (%s, %s, 'public') returning id",
            (alice_clip, alice),
        ).fetchone()["id"]
        conn.execute(
            "update public.clip_posts set status = 'published', external_id = 'abc' where id = %s",
            (post,),
        )
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute(
                "insert into public.clip_posts (clip_id, user_id, privacy) "
                "values (%s, %s, 'public')",
                (bob_clip, alice),
            )
    finally:
        conn.execute("reset role")

    _as(conn, bob)
    try:
        assert conn.execute("select count(*) as n from public.clip_posts").fetchone()["n"] == 0
    finally:
        conn.execute("reset role")
