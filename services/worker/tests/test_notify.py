from uuid import uuid4

import httpx

from clipper_worker import main as worker_main
from clipper_worker.notify import Mailer, Notification, Thumb, build_email
from clipper_worker.queue import JobQueue
from clipper_worker.storage import ClipStorage

from .test_queue import fake_run


class FakeMailer:
    def __init__(self):
        self.sent = []

    def send(self, to, email):
        self.sent.append((to, email))


def _email(conn, uid):
    return conn.execute("select email from auth.users where id = %s", (uid,)).fetchone()["email"]


def _owner(conn, pid):
    return conn.execute("select user_id from public.projects where id = %s", (pid,)).fetchone()[
        "user_id"
    ]


def test_ready_project_emails_the_owner_once(conn, make_project, tmp_path):
    pid = make_project()
    q, mailer = JobQueue(conn, "w1"), FakeMailer()
    worker_main.process(q, q.claim(), run=fake_run, work_root=tmp_path, mailer=mailer)

    assert len(mailer.sent) == 1
    to, email = mailer.sent[0]
    assert to == _email(conn, _owner(conn, pid))
    # New profiles default to English until the app records the language.
    assert email.subject == 'Clips from "My Video" are ready'
    assert f"https://www.sofish.tech/projects/{pid}" in email.text
    assert worker_main.notify_owner(q, pid, mailer) is False, "never mailed twice"


def test_retry_sends_nothing_until_the_job_fails_for_good(conn, make_project, tmp_path):
    pid = make_project()
    q, mailer = JobQueue(conn, "w1"), FakeMailer()

    def broken(options, report, work):
        raise RuntimeError("download blocked")

    for attempt in (1, 2, 3):
        assert len(mailer.sent) == 0, f"nothing sent before attempt {attempt}"
        worker_main.process(q, q.claim(), run=broken, work_root=tmp_path, mailer=mailer)
        conn.execute("update public.jobs set run_after = now()")
    assert len(mailer.sent) == 1
    assert mailer.sent[0][1].subject == 'Clips from "your project" could not be made'
    assert conn.execute(
        "select notified_at is not null as done from public.projects where id = %s", (pid,)
    ).fetchone()["done"]


def test_owner_who_turned_it_off_gets_nothing(conn, make_project, tmp_path):
    pid = make_project()
    conn.execute(
        "update public.profiles set notify_email = false, ui_language = 'id' where id = %s",
        (_owner(conn, pid),),
    )
    q, mailer = JobQueue(conn, "w1"), FakeMailer()
    worker_main.process(q, q.claim(), run=fake_run, work_root=tmp_path, mailer=mailer)
    assert mailer.sent == []


def test_user_can_flip_only_their_own_switch(conn, make_user):
    me, other = make_user(), make_user()
    conn.execute("set role authenticated")
    conn.execute("select set_config('request.jwt.claim.sub', %s, false)", (str(me),))
    try:
        conn.execute("update public.profiles set notify_email = false")
    finally:
        conn.execute("reset role")
    rows = conn.execute("select id, notify_email from public.profiles").fetchall()
    assert {r["id"]: r["notify_email"] for r in rows} == {me: False, other: True}


def test_indonesian_email_with_thumbnails():
    n = Notification("a@b.c", "id", "Podcast <42>", "ready", uuid4(), 3)
    email = build_email(n, "https://x/projects/1", [Thumb("Kenapa", "https://img/1.jpg")])
    assert email.subject == 'Klip dari "Podcast <42>" sudah siap'
    assert "3 klip dari Podcast &lt;42&gt; sudah siap" in email.html
    assert "Lihat 3 klip" in email.html and 'src="https://img/1.jpg"' in email.html


def test_failed_email_says_credits_came_back():
    n = Notification("a@b.c", "id", None, "failed", uuid4(), 0)
    email = build_email(n, "https://x/p", [Thumb("x", "https://img")])
    assert email.subject == 'Klip dari "project kamu" gagal dibuat'
    assert "dikembalikan" in email.text and "https://img" not in email.html


def test_mailer_posts_to_resend():
    seen = {}

    def handler(request):
        seen["auth"] = request.headers["authorization"]
        seen["body"] = request.read()
        return httpx.Response(200, json={"id": "e1"})

    mailer = Mailer(
        "re_key", "Sofish <n@sofish.tech>", httpx.Client(transport=httpx.MockTransport(handler))
    )
    mailer.send(
        "a@b.c", build_email(Notification("a@b.c", "en", "T", "ready", uuid4(), 1), "u", [])
    )
    assert seen["auth"] == "Bearer re_key" and b'"to":["a@b.c"]' in seen["body"]


def test_storage_signed_url_is_absolute():
    def handler(request):
        assert request.url.path == "/storage/v1/object/sign/clips/u/p/c.jpg"
        return httpx.Response(200, json={"signedURL": "/object/sign/clips/u/p/c.jpg?token=t"})

    storage = ClipStorage(
        "https://s.supabase.co", "k", httpx.Client(transport=httpx.MockTransport(handler))
    )
    assert (
        storage.signed_url("u/p/c.jpg", 60)
        == "https://s.supabase.co/storage/v1/object/sign/clips/u/p/c.jpg?token=t"
    )
