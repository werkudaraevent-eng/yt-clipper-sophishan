"""Worker loop: claim a job, run the pipeline, record the outcome, repeat."""

import logging
import os
import shutil
import signal
import socket
import time
from pathlib import Path

from pydantic import ValidationError

from .engine import pipeline, rerender
from .notify import Mailer, notify_owner
from .options import ClipEdit, JobOptions
from .queue import Job, JobQueue
from .storage import ClipStorage

log = logging.getLogger("clipper_worker")

POLL_INTERVAL_SECONDS = float(os.environ.get("CLIPPER_POLL_INTERVAL", "3"))
WORK_ROOT = Path(os.environ.get("CLIPPER_WORK_DIR", "/tmp/clipper"))
EXPIRE_INTERVAL_SECONDS = float(os.environ.get("CLIPPER_EXPIRE_INTERVAL", "3600"))


def paid_window(options: JobOptions, credits_charged: int) -> JobOptions:
    """Cut the timeframe down to the minutes that were paid for.

    The charge is computed from the video length the client reported, so a
    user who under-reports it pays for less than they asked for. The worker
    knows the real length and processes only what the credits cover.
    Projects from before credits (charged 0) are left alone.
    """
    tf = options.timeframe
    paid_end = tf.start + credits_charged * 60
    if credits_charged <= 0 or tf.end <= paid_end:
        return options
    log.warning(
        "timeframe %.0f-%.0fs cut to the %d paid minutes", tf.start, tf.end, credits_charged
    )
    return options.model_copy(update={"timeframe": tf.model_copy(update={"end": paid_end})})


def process(
    queue: JobQueue,
    job: Job,
    run=pipeline.run,
    work_root: Path = WORK_ROOT,
    storage: ClipStorage | None = None,
    mailer: Mailer | None = None,
) -> None:
    log.info("job %s: attempt %d/%d", job.id, job.attempt, job.max_attempts)
    if job.kind == "rerender_clip":
        process_edit(queue, job, work_root=work_root, storage=storage)
        return
    work = work_root / str(job.project_id)
    try:
        options = paid_window(JobOptions.model_validate(job.options), job.credits_charged)
        # A retry starts clean so half-written files from the last attempt
        # cannot end up in the results.
        shutil.rmtree(work, ignore_errors=True)
        terms = queue.terms(job.user_id)
        result = run(options, lambda stage, p: queue.progress(job, stage, p), work, terms=terms)
        paths: dict[Path, str] = {}
        if storage is not None:
            queue.progress(job, "upload", 1.0)
            for clip in result.clips:
                for file in (clip.video_path, clip.thumbnail_path):
                    paths[file] = storage.upload(job.user_id, job.project_id, file)
        queue.save_results(job, result, paths)
    except ValidationError as exc:
        # Bad options never succeed on retry: fail for good.
        queue.give_up(job, f"invalid options: {exc.errors(include_url=False)}")
        log.warning("job %s: invalid options", job.id)
    except Exception as exc:  # noqa: BLE001 - any stage error is recorded on the job
        log.exception("job %s failed", job.id)
        queue.fail(job, f"{type(exc).__name__}: {exc}")
    else:
        queue.succeed(job)
        log.info("job %s: done, %d clips", job.id, len(result.clips))
        if storage is not None:
            shutil.rmtree(work, ignore_errors=True)
    # Ready, or failed for good: tell the owner. A job that will be retried
    # leaves the project queued, and nothing is sent yet.
    try:
        notify_owner(queue, job.project_id, mailer, storage)
    except Exception:  # noqa: BLE001 - the email must never fail the job
        log.exception("job %s: done email failed", job.id)


def process_edit(
    queue: JobQueue,
    job: Job,
    run=rerender.rerender,
    work_root: Path = WORK_ROOT,
    storage: ClipStorage | None = None,
) -> None:
    """Render one clip again with its owner's edit and replace its files."""
    work = work_root / f"edit-{job.clip_id}"
    try:
        options = JobOptions.model_validate(job.options)
        edit = ClipEdit.model_validate(job.payload or {})
        clip = queue.load_clip(job.clip_id) if job.clip_id else None
        if clip is None:
            queue.give_up(job, "clip not found")
            return
        shutil.rmtree(work, ignore_errors=True)
        work.mkdir(parents=True)

        def current_video() -> Path | None:
            path = clip.video_path
            if not path:
                return None
            if path.startswith("/"):  # dev without storage
                return Path(path)
            return storage.download(path, work / "current.mp4") if storage else None

        result = run(
            options,
            clip,
            edit,
            work,
            lambda stage, p: queue.progress(job, stage, p),
            current_video=current_video,
            terms=queue.terms(job.user_id),
        )
        paths: dict[Path, str] = {}
        if storage is not None:
            queue.progress(job, "upload", 1.0)
            for file in (result.video_path, result.thumbnail_path):
                paths[file] = storage.upload(job.user_id, job.project_id, file)
        queue.save_edit(clip, result, paths)
    except ValidationError as exc:
        queue.give_up(job, f"invalid edit: {exc.errors(include_url=False)}")
        log.warning("job %s: invalid edit", job.id)
    except Exception as exc:  # noqa: BLE001 - recorded on the job, retried
        log.exception("job %s failed", job.id)
        queue.fail(job, f"{type(exc).__name__}: {exc}")
    else:
        queue.succeed(job)
        log.info("job %s: clip %s re-rendered", job.id, job.clip_id)
        if storage is not None:
            shutil.rmtree(work, ignore_errors=True)


def expire(queue: JobQueue, storage: ClipStorage | None) -> int:
    """Expire overdue projects and delete their files. Returns projects' file count."""
    paths = queue.expire_projects()
    remote = [p for p in paths if not p.startswith("/")]
    if remote and storage is not None:
        storage.delete(remote)
    for p in paths:
        if p.startswith("/"):
            Path(p).unlink(missing_ok=True)
    if paths:
        log.info("expired projects: deleted %d files", len(paths))
    return len(paths)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    worker_id = os.environ.get("CLIPPER_WORKER_ID") or f"{socket.gethostname()}-{os.getpid()}"
    queue = JobQueue.connect(os.environ["DATABASE_URL"], worker_id)
    storage = ClipStorage.from_env()
    if storage is None:
        log.warning("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set: clips stay on local disk")
    mailer = Mailer.from_env()
    if mailer is None:
        log.warning("RESEND_API_KEY not set: no done emails")

    stopping = False

    def stop(*_: object) -> None:
        nonlocal stopping
        stopping = True
        log.info("stopping after the current job")

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    log.info("worker %s polling for jobs", worker_id)
    next_expiry = 0.0
    while not stopping:
        if time.monotonic() >= next_expiry:
            try:
                expire(queue, storage)
            except Exception:  # noqa: BLE001 - expiry must not stop the worker
                log.exception("project expiry failed")
            next_expiry = time.monotonic() + EXPIRE_INTERVAL_SECONDS
        job = queue.claim()
        if job is None:
            time.sleep(POLL_INTERVAL_SECONDS)
            continue
        process(queue, job, storage=storage, mailer=mailer)


if __name__ == "__main__":
    main()
