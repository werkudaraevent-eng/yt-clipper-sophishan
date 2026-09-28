import os
import subprocess
import uuid
from pathlib import Path

import psycopg
import pytest
from psycopg.rows import dict_row

REPO = Path(__file__).resolve().parents[3]
FIXTURES = REPO / "fixtures"


@pytest.fixture(autouse=True)
def _no_llm_gateway(monkeypatch):
    """Tests pick the API mode explicitly; ignore a gateway set in the shell."""
    monkeypatch.delenv("CLIPPER_LLM_BASE_URL", raising=False)


@pytest.fixture(scope="session")
def database_url():
    """A throwaway database with every migration applied.

    Needs TEST_DATABASE_URL pointing at a Postgres server we may create
    databases on; tests that use it are skipped otherwise.
    """
    admin_url = os.environ.get("TEST_DATABASE_URL")
    if not admin_url:
        pytest.skip("TEST_DATABASE_URL not set")
    name = f"clipper_test_{uuid.uuid4().hex[:8]}"
    with psycopg.connect(admin_url, autocommit=True) as admin:
        admin.execute(f'create database "{name}"')
    url = psycopg.conninfo.make_conninfo(admin_url, dbname=name)
    subprocess.run(
        ["sh", str(REPO / "supabase/dev/apply.sh")],
        env={**os.environ, "DATABASE_URL": url},
        check=True,
        capture_output=True,
    )
    yield url
    with psycopg.connect(admin_url, autocommit=True) as admin:
        admin.execute(f'drop database "{name}" with (force)')


@pytest.fixture
def conn(database_url):
    with psycopg.connect(database_url, autocommit=True, row_factory=dict_row) as c:
        yield c
        c.execute("truncate auth.users, public.credit_ledger cascade")


@pytest.fixture
def make_user(conn):
    def _make(email="user@example.com"):
        uid = uuid.uuid4()
        conn.execute(
            "insert into auth.users (id, email) values (%s, %s)", (uid, f"{uid.hex[:6]}{email}")
        )
        return uid

    return _make


@pytest.fixture
def make_project(conn, make_user):
    def _make(user_id=None, options=None):
        user_id = user_id or make_user()
        options = options or {
            "youtubeUrl": "https://youtu.be/arj7oStGLkU",
            "timeframe": {"start": 0, "end": 600},
        }
        row = conn.execute(
            "insert into public.projects (user_id, youtube_url, options) "
            "values (%s, %s, %s) returning id",
            (user_id, options["youtubeUrl"], psycopg.types.json.Jsonb(options)),
        ).fetchone()
        return row["id"]

    return _make
