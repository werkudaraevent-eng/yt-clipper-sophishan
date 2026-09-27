"""Thin wrapper over the job-queue SQL functions in supabase/migrations."""

from dataclasses import dataclass
from typing import Any
from uuid import UUID

import psycopg
from psycopg.rows import dict_row


@dataclass(frozen=True)
class Job:
    id: UUID
    project_id: UUID
    kind: str
    attempt: int
    max_attempts: int
    options: dict[str, Any]


class JobQueue:
    def __init__(self, conn: psycopg.Connection, worker_id: str) -> None:
        self.conn = conn
        self.worker_id = worker_id

    @classmethod
    def connect(cls, database_url: str, worker_id: str) -> "JobQueue":
        return cls(psycopg.connect(database_url, autocommit=True, row_factory=dict_row), worker_id)

    def claim(self) -> Job | None:
        row = self.conn.execute(
            """
            select j.id, j.project_id, j.kind, j.attempt, j.max_attempts, p.options
              from public.claim_job(%s) j
              join public.projects p on p.id = j.project_id
            """,
            (self.worker_id,),
        ).fetchone()
        if row is None:
            return None
        return Job(**row)

    def progress(self, job: Job, stage: str, progress: float) -> None:
        self.conn.execute(
            "select public.report_job_progress(%s, %s, %s, %s::real)",
            (job.id, self.worker_id, stage, max(0.0, min(1.0, progress))),
        )

    def succeed(self, job: Job) -> None:
        self.conn.execute("select public.finish_job(%s, %s, true)", (job.id, self.worker_id))

    def fail(self, job: Job, error: str) -> None:
        self.conn.execute(
            "select public.finish_job(%s, %s, false, %s)",
            (job.id, self.worker_id, error[:2000]),
        )
