"""Thin wrapper over the job-queue SQL functions in supabase/migrations."""

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any
from uuid import UUID

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

if TYPE_CHECKING:
    from .engine.pipeline import PipelineResult


@dataclass(frozen=True)
class Job:
    id: UUID
    project_id: UUID
    user_id: UUID
    kind: str
    attempt: int
    max_attempts: int
    options: dict[str, Any]
    # Credits taken when the project was created: one per minute of timeframe.
    credits_charged: int = 0


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
            select j.id, j.project_id, p.user_id, j.kind, j.attempt, j.max_attempts, p.options,
                   p.credits_charged
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

    def save_results(
        self, job: Job, result: "PipelineResult", paths: dict[Path, str] | None = None
    ) -> None:
        """Store video metadata and clip rows. Replaces clips of earlier attempts.

        `paths` maps local files to their storage paths; files missing from it
        are recorded by local path (dev without storage).
        """
        paths = paths or {}
        src = result.source
        with self.conn.transaction():
            self.conn.execute(
                """
                update public.projects
                   set title = coalesce(%s, title), youtube_id = coalesce(%s, youtube_id),
                       thumbnail_url = coalesce(%s, thumbnail_url),
                       duration_seconds = coalesce(%s, duration_seconds),
                       video_language = coalesce(%s, video_language), updated_at = now()
                 where id = %s
                """,
                (
                    src.title,
                    src.video_id,
                    src.thumbnail,
                    round(src.duration) if src.duration else None,
                    src.language,
                    job.project_id,
                ),
            )
            self.conn.execute("delete from public.clips where project_id = %s", (job.project_id,))
            for clip in result.clips:
                h = clip.highlight
                self.conn.execute(
                    """
                    insert into public.clips (project_id, position, start_seconds, end_seconds,
                        title, hook_text, description, virality_score, reason,
                        video_path, thumbnail_path, caption_words)
                    values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        job.project_id, clip.position, h.start, h.end, h.title, h.hook_text,
                        h.description, h.virality_score, h.reason,
                        paths.get(clip.video_path, str(clip.video_path)),
                        paths.get(clip.thumbnail_path, str(clip.thumbnail_path)),
                        Jsonb([{"text": w.text, "start": w.start, "end": w.end}
                               for w in clip.words]),
                    ),
                )  # fmt: skip

    def expire_projects(self, batch: int = 100) -> list[str]:
        """Expire overdue projects; returns the clip file paths to delete."""
        rows = self.conn.execute("select path from public.expire_projects(%s)", (batch,)).fetchall()
        return [r["path"] for r in rows]

    def give_up(self, job: Job, error: str) -> None:
        """Fail without retrying (the error cannot go away on its own)."""
        self.conn.execute(
            "update public.jobs set attempt = max_attempts where id = %s and locked_by = %s",
            (job.id, self.worker_id),
        )
        self.fail(job, error)

    def fail(self, job: Job, error: str) -> None:
        self.conn.execute(
            "select public.finish_job(%s, %s, false, %s)",
            (job.id, self.worker_id, error[:2000]),
        )
