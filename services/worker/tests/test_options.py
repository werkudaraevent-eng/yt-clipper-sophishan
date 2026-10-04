import json

import pytest
from pydantic import ValidationError

from clipper_worker.options import ClipEdit, JobOptions

from .conftest import FIXTURES

VALID = json.loads((FIXTURES / "job-options.valid.json").read_text())
INVALID = json.loads((FIXTURES / "job-options.invalid.json").read_text())


@pytest.mark.parametrize("value", VALID)
def test_accepts_valid_fixtures(value):
    JobOptions.model_validate(value)


@pytest.mark.parametrize("value", INVALID)
def test_rejects_invalid_fixtures(value):
    with pytest.raises(ValidationError):
        JobOptions.model_validate(value)


def test_defaults_match_shared_schema():
    o = JobOptions.model_validate(VALID[0])
    assert o.clip_length == "30to60"
    assert o.clip_length_range == (30, 60)
    assert o.captions.template == "karaoke"
    assert o.captions.position == "bottom"
    assert o.captions.words_per_caption == 3
    assert o.layout == "auto"
    assert o.hook_title is True
    assert o.cold_open is True
    assert o.caption_translation is None


EDIT_VALID = json.loads((FIXTURES / "clip-edit.valid.json").read_text())
EDIT_INVALID = json.loads((FIXTURES / "clip-edit.invalid.json").read_text())


@pytest.mark.parametrize("value", EDIT_VALID)
def test_accepts_valid_clip_edits(value):
    ClipEdit.model_validate(value)


@pytest.mark.parametrize("value", EDIT_INVALID)
def test_rejects_invalid_clip_edits(value):
    with pytest.raises(ValidationError):
        ClipEdit.model_validate(value)
