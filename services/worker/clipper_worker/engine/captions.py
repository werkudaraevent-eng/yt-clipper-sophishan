"""Animated word-by-word captions and the hook title, as an ASS subtitle file.

Rendered by libass through FFmpeg's `ass` filter. Each template is a small set
of style values; see supabase/migrations for the matching `caption_templates`
rows the UI lists.
"""

from dataclasses import dataclass
from pathlib import Path

from .transcript import Word


@dataclass(frozen=True)
class Template:
    font: str
    uppercase: bool
    size: float  # font size as a fraction of frame height
    text: str  # colour of words, #RRGGBB
    active: str  # colour of the word being spoken
    outline: float  # outline width as a fraction of frame height (0 = none)
    box: str | None = None  # opaque box behind the whole line
    active_box: str | None = None  # box behind the spoken word only
    upcoming: str | None = None  # colour of words not yet spoken


TEMPLATES: dict[str, Template] = {
    "karaoke": Template(
        font="Montserrat ExtraBold",
        uppercase=True,
        size=0.045,
        text="#FFFFFF",
        active="#39FF14",
        outline=0.004,
    ),
    "box": Template(
        font="Montserrat ExtraBold",
        uppercase=True,
        size=0.043,
        text="#FFFFFF",
        active="#FFFFFF",
        outline=0.003,
        active_box="#E0245E",
    ),
    "ali": Template(
        font="Montserrat SemiBold",
        uppercase=False,
        size=0.034,
        text="#111111",
        active="#111111",
        outline=0.0,
        box="#FFFFFF",
        upcoming="#9CA3AF",
    ),
}

# Vertical anchor per caption position: (ASS alignment, margin as fraction of height)
POSITIONS = {"top": (8, 0.16), "middle": (5, 0.0), "bottom": (2, 0.22)}


def _ass_color(hex_rgb: str, alpha: int = 0) -> str:
    """#RRGGBB -> &HAABBGGRR (ASS is little-endian BGR with inverted alpha)."""
    r, g, b = hex_rgb[1:3], hex_rgb[3:5], hex_rgb[5:7]
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def _inline_color(hex_rgb: str) -> str:
    r, g, b = hex_rgb[1:3], hex_rgb[3:5], hex_rgb[5:7]
    return f"&H{b}{g}{r}&".upper()


def _ts(seconds: float) -> str:
    seconds = max(0.0, seconds)
    cs = int(round(seconds * 100))
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _clean(text: str) -> str:
    return text.replace("\\", "").replace("{", "").replace("}", "").strip()


def _wrap(text: str, max_chars: int) -> str:
    lines, line = [], ""
    for word in text.split():
        if line and len(line) + 1 + len(word) > max_chars:
            lines.append(line)
            line = word
        else:
            line = f"{line} {word}".strip()
    if line:
        lines.append(line)
    return r"\N".join(lines)


def chunk_words(
    words: list[Word], per_caption: int, max_gap: float = 0.8, cuts: tuple[float, ...] = ()
) -> list[list[Word]]:
    """Group words into caption lines, breaking early on pauses, sentence ends
    and `cuts` (times where the picture jumps, such as the end of a cold open)."""
    chunks: list[list[Word]] = []
    current: list[Word] = []
    for w in words:
        if current and (
            len(current) >= per_caption
            or w.start - current[-1].end > max_gap
            or current[-1].text.endswith((".", "?", "!"))
            or any(current[-1].start < c <= w.start for c in cuts)
        ):
            chunks.append(current)
            current = []
        current.append(w)
    if current:
        chunks.append(current)
    return chunks


def build_ass(
    words: list[Word],
    *,
    width: int,
    height: int,
    template: str = "karaoke",
    position: str = "bottom",
    words_per_caption: int = 3,
    hook_text: str | None = None,
    hook_seconds: float = 3.0,
    captions: bool = True,
    cuts: tuple[float, ...] = (),
) -> str:
    """ASS script for one clip. `words` must already be relative to the clip start."""
    t = TEMPLATES[template]
    align, margin_frac = POSITIONS[position]
    font_size = round(t.size * height)
    outline = round(t.outline * height)
    margin_v = round(margin_frac * height)
    margin_h = round(0.06 * width)

    if t.box or t.active_box:
        # BorderStyle 3 draws an opaque box in the outline colour.
        border_style, style_outline = 3, max(1, round(0.008 * height))
        box_colour = _ass_color(t.box) if t.box else _ass_color("#000000", 0xFF)
    else:
        border_style, style_outline = 1, outline
        box_colour = _ass_color("#000000")

    hook_size = round(0.04 * height)
    styles = [
        f"Style: Caption,{t.font},{font_size},{_ass_color(t.text)},{_ass_color(t.active)},"
        f"{box_colour},&H80000000,0,0,0,0,100,100,0,0,{border_style},{style_outline},"
        f"0,{align},{margin_h},{margin_h},{margin_v},1",
        f"Style: Hook,Montserrat ExtraBold,{hook_size},&H00111111,&H00111111,&H00FFFFFF,"
        "&H00000000,0,0,0,0,"
        f"100,100,0,0,3,{max(1, round(0.012 * height))},0,8,{margin_h},{margin_h},"
        f"{round(0.08 * height)},1",
    ]

    events: list[str] = []
    if hook_text and (hook := _clean(hook_text)):
        events.append(
            f"Dialogue: 1,{_ts(0)},{_ts(hook_seconds)},Hook,,0,0,0,,"
            r"{\fad(150,250)}" + _wrap(hook, 24)
        )

    if captions:
        for chunk in chunk_words(words, words_per_caption, cuts=cuts):
            tokens = [_clean(w.text.upper() if t.uppercase else w.text) for w in chunk]
            for i, word in enumerate(chunk):
                start = word.start
                end = chunk[i + 1].start if i + 1 < len(chunk) else chunk[-1].end
                parts = []
                for j, token in enumerate(tokens):
                    if not token:
                        continue
                    if j == i:
                        tag = r"{\c" + _inline_color(t.active)
                        if t.active_box:
                            tag += r"\3c" + _inline_color(t.active_box) + r"\3a&H00&"
                        parts.append(tag + "}" + token + "{\\r}")
                    elif j > i and t.upcoming:
                        parts.append(r"{\c" + _inline_color(t.upcoming) + "}" + token + "{\\r}")
                    else:
                        parts.append(token)
                events.append(
                    f"Dialogue: 0,{_ts(start)},{_ts(end)},Caption,,0,0,0,," + " ".join(parts)
                )

    return (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        "WrapStyle: 0\n"
        f"PlayResX: {width}\nPlayResY: {height}\n"
        "ScaledBorderAndShadow: yes\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
        "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
        "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        + "\n".join(styles)
        + "\n\n[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
        + "\n".join(events)
        + "\n"
    )


def write_ass(path: Path, **kwargs) -> Path:
    path.write_text(build_ass(**kwargs), encoding="utf-8")
    return path
