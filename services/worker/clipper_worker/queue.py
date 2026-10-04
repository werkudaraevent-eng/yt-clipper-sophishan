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
    from .engine.rerender import ClipRow, Rerendered
    from .engine.transcript import Word
    from .notify import Notification


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
    # A re-render ('rerender_clip'): the clip and the edit to apply.
    clip_id: UUID | None = None
    payload: dict[str, Any] | None = None


def _words_json(words: "list[Word]") -> Jsonb:
    return Jsonb([{"text": w.text, "start": w.start, "end": w.end} for w in words])


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
                   p.credits_charged, j.clip_id, j.payload
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
                        video_path, thumbnail_path, caption_words, render)
                    values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        job.project_id, clip.position, h.start, h.end, h.title, h.hook_text,
                        h.description, h.virality_score, h.reason,
                        paths.get(clip.video_path, str(clip.video_path)),
                        paths.get(clip.thumbnail_path, str(clip.thumbnail_path)),
                        _words_json(clip.words),
                        Jsonb(clip.render) if clip.render is not None else None,
                    ),
                )  # fmt: skip

    def load_clip(self, clip_id: UUID) -> "ClipRow | None":
        from .engine.rerender import ClipRow
        from .engine.transcript import Word

        row = self.conn.execute(
            """
            select id, position, start_seconds, end_seconds, title, hook_text, description,
                   virality_score, reason, video_path, caption_words, render
              from public.clips where id = %s
            """,
            (clip_id,),
        ).fetchone()
        if row is None:
            return None
        return ClipRow(
            id=row["id"], position=row["position"], start=row["start_seconds"],
            end=row["end_seconds"], title=row["title"] or "", hook_text=row["hook_text"] or "",
            description=row["description"] or "", virality_score=round(row["virality_score"] or 0),
            reason=row["reason"] or "", video_path=row["video_path"],
            words=[Word(w["text"], w["start"], w["end"]) for w in row["caption_words"] or []],
            render=row["render"],
        )  # fmt: skip

    def terms(self, user_id: UUID) -> list[tuple[str, str]]:
        """The owner's name dictionary: (wrong, correct) spellings."""
        rows = self.conn.execute(
            "select wrong, correct from public.user_terms where user_id = %s order by id",
            (user_id,),
        ).fetchall()
        return [(r["wrong"], r["correct"]) for r in rows]

    def save_edit(
        self, clip: "ClipRow", result: "Rerendered", paths: dict[Path, str] | None = None
    ) -> None:
        """Point the clip row at its re-rendered files and record the edit."""
        paths = paths or {}
        self.conn.execute(
            """
            update public.clips
               set start_seconds = %s, end_seconds = %s, hook_text = %s, caption_words = %s,
                   render = %s, video_path = %s, thumbnail_path = %s, edited_at = now()
             where id = %s
            """,
            (
                result.start, result.end, result.hook_text, _words_json(result.words),
                Jsonb(result.render),
                paths.get(result.video_path, str(result.video_path)),
                paths.get(result.thumbnail_path, str(result.thumbnail_path)),
                clip.id,
            ),
        )  # fmt: skip

    def expire_projects(self, batch: int = 100) -> list[str]:
        """Expire overdue projects; returns the clip file paths to delete."""
        rows = self.conn.execute("select path from public.expire_projects(%s)", (batch,)).fetchall()
        return [r["path"] for r in rows]

    def take_notification(self, project_id: UUID) -> "Notification | None":
        """Mark a finished project as notified; returns what the email needs, if wanted."""
        from .notify import Notification

        row = self.conn.execute(
            "select * from public.take_project_notification(%s)", (project_id,)
        ).fetchone()
        return Notification(**row) if row else None

    def top_clips(self, project_id: UUID, limit: int) -> list[tuple[str | None, str | None]]:
        """(title, thumbnail path) of the best-scored clips, for the done email."""
        rows = self.conn.execute(
            """
            select title, thumbnail_path from public.clips where project_id = %s
             order by virality_score desc nulls last, position limit %s
            """,
            (project_id, limit),
        ).fetchall()
        return [(r["title"], r["thumbnail_path"]) for r in rows]

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
