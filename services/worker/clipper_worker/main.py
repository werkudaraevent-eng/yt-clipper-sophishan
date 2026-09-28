"""Worker loop: claim a job, run the pipeline, record the outcome, repeat."""

import logging
import os
import shutil
import signal
import socket
import time
from pathlib import Path

from pydantic import ValidationError

from .engine import pipeline
from .options import JobOptions
from .queue import Job, JobQueue
from .storage import ClipStorage

log = logging.getLogger("clipper_worker")

POLL_INTERVAL_SECONDS = float(os.environ.get("CLIPPER_POLL_INTERVAL", "3"))
WORK_ROOT = Path(os.environ.get("CLIPPER_WORK_DIR", "/tmp/clipper"))


def process(
    queue: JobQueue,
    job: Job,
    run=pipeline.run,
    work_root: Path = WORK_ROOT,
    storage: ClipStorage | None = None,
) -> None:
    log.info("job %s: attempt %d/%d", job.id, job.attempt, job.max_attempts)
    work = work_root / str(job.project_id)
    try:
        options = JobOptions.model_validate(job.options)
        # A retry starts clean so half-written files from the last attempt
        # cannot end up in the results.
        shutil.rmtree(work, ignore_errors=True)
        result = run(options, lambda stage, p: queue.progress(job, stage, p), work)
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


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    worker_id = os.environ.get("CLIPPER_WORKER_ID") or f"{socket.gethostname()}-{os.getpid()}"
    queue = JobQueue.connect(os.environ["DATABASE_URL"], worker_id)
    storage = ClipStorage.from_env()
    if storage is None:
        log.warning("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set: clips stay on local disk")

    stopping = False

    def stop(*_: object) -> None:
        nonlocal stopping
        stopping = True
        log.info("stopping after the current job")

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    log.info("worker %s polling for jobs", worker_id)
    while not stopping:
        job = queue.claim()
        if job is None:
            time.sleep(POLL_INTERVAL_SECONDS)
            continue
        process(queue, job, storage=storage)


if __name__ == "__main__":
    main()
