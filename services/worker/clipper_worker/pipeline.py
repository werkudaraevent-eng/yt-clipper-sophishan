"""Clip pipeline entry point.

M0 ships a dry run that validates options and walks the stages so the queue,
progress reporting and UI can be exercised end to end. M1 replaces each stage
with the real download / transcribe / analyze / render steps.
"""

from collections.abc import Callable

from .options import JobOptions

STAGES = ("download", "transcribe", "analyze", "render")

ProgressFn = Callable[[str, float], None]


def run(options: JobOptions, report: ProgressFn) -> None:
    for i, stage in enumerate(STAGES):
        report(stage, i / len(STAGES))
    report(STAGES[-1], 1.0)
