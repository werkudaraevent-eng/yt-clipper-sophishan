"""Command line entry point for the clip engine.

    python -m clipper_worker.cli "https://youtu.be/..." --end 600 --out ./out
    python -m clipper_worker.cli --video talk.mp4 --words talk.words.json --out ./out

Without ANTHROPIC_API_KEY, pass --offline to pick clips by speech density
(development only).
"""

import argparse
import json
import logging
import os
import sys
from pathlib import Path

from .engine import pipeline
from .options import JobOptions


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="clipper", description=__doc__.split("\n\n")[0])
    p.add_argument("url", nargs="?", help="YouTube URL")
    p.add_argument("--video", type=Path, help="local video instead of a URL")
    p.add_argument("--words", type=Path, help="word timings JSON for --video")
    p.add_argument("--title", default="Local video")
    p.add_argument("--language", default="auto", help="video language code, or auto")
    p.add_argument("--translate", default=None, help="caption/output language code")
    p.add_argument("--start", type=float, default=0)
    p.add_argument("--end", type=float, default=600)
    p.add_argument("--length", default="30to60", choices=["lt30", "30to60", "60to90", "original"])
    p.add_argument("--template", default="karaoke", choices=["karaoke", "box", "ali"])
    p.add_argument("--position", default="bottom", choices=["top", "middle", "bottom"])
    p.add_argument("--words-per-caption", type=int, default=3)
    p.add_argument("--no-captions", action="store_true")
    p.add_argument("--no-hook", action="store_true")
    p.add_argument("--layout", default="auto", choices=["auto", "fill", "fit", "square"])
    p.add_argument("--direction", default="", help="free-text AI direction")
    p.add_argument("--offline", action="store_true", help="no LLM: density heuristic")
    p.add_argument("--out", type=Path, default=Path("out"))
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    if not args.url and not (args.video and args.words):
        p.error("give a YouTube URL, or --video together with --words")
    if args.offline:
        os.environ["CLIPPER_ALLOW_OFFLINE_HIGHLIGHTS"] = "1"
        os.environ.pop("ANTHROPIC_API_KEY", None)

    options = JobOptions.model_validate(
        {
            "youtubeUrl": args.url or "https://youtu.be/localvideo0",
            "videoLanguage": args.language,
            "captionTranslation": args.translate,
            "timeframe": {"start": args.start, "end": args.end},
            "clipLength": args.length,
            "captions": {
                "enabled": not args.no_captions,
                "template": args.template,
                "position": args.position,
                "wordsPerCaption": args.words_per_caption,
            },
            "hookTitle": not args.no_hook,
            "layout": args.layout,
            "aiDirection": args.direction,
        }
    )
    source = None
    if args.video:
        language = None if args.language == "auto" else args.language
        source = pipeline.local_source(args.video, args.words, args.title, language)

    result = pipeline.run(
        options,
        lambda stage, p: logging.info("[%s] %3.0f%%", stage, p * 100),
        args.out,
        source=source,
    )
    json.dump(result.manifest(), sys.stdout, ensure_ascii=False, indent=2)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
