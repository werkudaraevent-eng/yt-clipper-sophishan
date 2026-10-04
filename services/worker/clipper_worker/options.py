"""Job options, mirroring packages/shared/src/jobOptions.ts.

Both sides are tested against fixtures/job-options.*.json so they cannot drift.
"""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

YOUTUBE_URL = re.compile(
    r"^https?://(?:www\.|m\.)?(?:youtube\.com/(?:watch\?v=|shorts/|live/)|youtu\.be/)[\w-]{11}"
)
LANGUAGE_CODE = r"^[a-z]{2,3}(-[A-Za-z]{2,4})?$"

ClipLength = Literal["lt30", "30to60", "60to90", "original"]

CLIP_LENGTH_RANGES: dict[str, tuple[float, float] | None] = {
    "lt30": (10, 30),
    "30to60": (30, 60),
    "60to90": (60, 90),
    "original": None,
}


class _Model(BaseModel):
    # Unknown keys are ignored, as zod's default object parsing does.
    model_config = ConfigDict(populate_by_name=True, extra="ignore", frozen=True)


class Timeframe(_Model):
    start: float = Field(ge=0)
    end: float = Field(gt=0)


class Captions(_Model):
    enabled: bool = True
    template: Literal["karaoke", "box", "ali"] = "karaoke"
    position: Literal["top", "middle", "bottom"] = "bottom"
    words_per_caption: int = Field(default=3, ge=1, le=6, alias="wordsPerCaption")


class JobOptions(_Model):
    youtube_url: str = Field(alias="youtubeUrl")
    video_language: str = Field(default="auto", alias="videoLanguage")
    caption_translation: str | None = Field(
        default=None, alias="captionTranslation", pattern=LANGUAGE_CODE
    )
    timeframe: Timeframe
    clip_length: ClipLength = Field(default="30to60", alias="clipLength")
    captions: Captions = Captions()
    hook_title: bool = Field(default=True, alias="hookTitle")
    cold_open: bool = Field(default=True, alias="coldOpen")
    layout: Literal["auto", "fill", "fit", "square"] = "auto"
    ai_direction: str = Field(default="", max_length=1000, alias="aiDirection")

    @field_validator("youtube_url")
    @classmethod
    def _youtube(cls, v: str) -> str:
        if not YOUTUBE_URL.match(v):
            raise ValueError("Not a YouTube video URL")
        return v

    @field_validator("video_language")
    @classmethod
    def _language(cls, v: str) -> str:
        if v != "auto" and not re.match(LANGUAGE_CODE, v):
            raise ValueError("ISO language code or 'auto'")
        return v

    @model_validator(mode="after")
    def _timeframe_order(self) -> "JobOptions":
        if self.timeframe.end <= self.timeframe.start:
            raise ValueError("timeframe.end must be after timeframe.start")
        return self

    @property
    def clip_length_range(self) -> tuple[float, float] | None:
        return CLIP_LENGTH_RANGES[self.clip_length]


class EditWord(_Model):
    text: str = Field(min_length=1, max_length=80)
    start: float = Field(ge=0)
    end: float = Field(ge=0)


class EditStyle(_Model):
    """How a clip looks; a key left out keeps what the clip has now."""

    template: Literal["karaoke", "box", "ali"] | None = None
    position: Literal["top", "middle", "bottom"] | None = None
    words_per_caption: int | None = Field(default=None, ge=1, le=6, alias="wordsPerCaption")
    layout: Literal["auto", "fill", "fit", "square"] | None = None
    hook_title: bool | None = Field(default=None, alias="hookTitle")
    cold_open: bool | None = Field(default=None, alias="coldOpen")


class ClipEdit(_Model):
    """One saved edit of a finished clip, mirroring packages/shared/src/clipEdit.ts.

    Only what changed is set. `words` are the captions over the clip's current
    range, in video seconds; `start`/`end` move the cut.
    """

    words: list[EditWord] | None = Field(default=None, max_length=3000)
    hook: str | None = Field(default=None, max_length=120)
    start: float | None = Field(default=None, ge=0)
    end: float | None = Field(default=None, gt=0)
    style: EditStyle | None = None

    @model_validator(mode="after")
    def _order(self) -> "ClipEdit":
        if self.start is not None and self.end is not None and self.end - self.start < 3:
            raise ValueError("a clip runs at least 3 seconds")
        return self
