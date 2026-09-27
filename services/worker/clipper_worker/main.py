"""Worker loop: claim a job, run the pipeline, record the outcome, repeat."""

import logging
import os
import signal
import socket
import time

from pydantic import ValidationError

from . import pipeline
from .options import JobOptions
from .queue import Job, JobQueue

log = logging.getLogger("clipper_worker")

POLL_INTERVAL_SECONDS = float(os.environ.get("CLIPPER_POLL_INTERVAL", "3"))


def process(queue: JobQueue, job: Job) -> None:
    log.info("job %s: attempt %d/%d", job.id, job.attempt, job.max_attempts)
    try:
        options = JobOptions.model_validate(job.options)
        pipeline.run(options, lambda stage, p: queue.progress(job, stage, p))
    except ValidationError as exc:
        # Bad options never succeed on retry: fail for good.
        queue.conn.execute("update public.jobs set attempt = max_attempts where id = %s", (job.id,))
        queue.fail(job, f"invalid options: {exc.errors(include_url=False)}")
        log.warning("job %s: invalid options", job.id)
    except Exception as exc:  # noqa: BLE001 - any stage error is recorded on the job
        log.exception("job %s failed", job.id)
        queue.fail(job, f"{type(exc).__name__}: {exc}")
    else:
        queue.succeed(job)
        log.info("job %s: done", job.id)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    worker_id = os.environ.get("CLIPPER_WORKER_ID") or f"{socket.gethostname()}-{os.getpid()}"
    queue = JobQueue.connect(os.environ["DATABASE_URL"], worker_id)

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
        process(queue, job)


if __name__ == "__main__":
    main()
