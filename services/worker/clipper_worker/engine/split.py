"""Split-screen layouts for the Auto layout: 1, 2, 3 or 4 people at once.

Most of the time the crop shows one person: whoever is talking (see
reframe.plan_speaker_crops). When several people are in the same exchange
(two people trading quick lines, or a table laughing together) the frame is
split so everyone in it is on screen:

  2 people  - stacked top / bottom
  3 people  - the main speaker on top, the other two side by side below
  4 people  - a 2 x 2 grid

The plan is a list of segments, each a time range and the faces to show. It
is rendered by trimming the clip into those segments, laying each one out,
and joining them back together.
"""

from dataclasses import dataclass

from .reframe import OUT_H, OUT_W, Reframe, Sample, speech_pieces, speech_spans

# A split has to last this long to be used; shorter moments stay one person.
MIN_SPLIT_SECONDS = 2.0
# Someone counts as talking along with the winner at this share of their mouth
# movement, and when clearly above their own resting level.
ACTIVE_SHARE = 0.5
ACTIVE_OVER_REST = 2.0
ACTIVE_FLOOR = 0.05
# Turns closer together than this make a back-and-forth.
EXCHANGE_SECONDS = 3.0
# People this close together already fit in one 9:16 crop: no split needed.
FITS_SHARE = 0.8
FPS = 30


@dataclass(frozen=True)
class Person:
    x: float  # face centre, 0..1 of width
    y: float  # face centre, 0..1 of height
    h: float  # face height, 0..1 of height


@dataclass(frozen=True)
class Segment:
    start: float
    end: float
    people: tuple[Person, ...]  # 1 to 4; with one, `people[0].x` is the crop centre


def _percentile(values: list[float], q: float) -> float:
    v = sorted(values)
    return v[min(len(v) - 1, int(q * len(v)))] if v else 0.0


def plan_layout(
    samples: list[Sample],
    words,
    keyframes: list[tuple[float, float]],
    duration: float,
    src_aspect: float,
) -> list[Segment]:
    """Segments covering [0, duration]. `keyframes` is the one-person plan.

    `src_aspect` is the source width / height, used to tell whether a group
    already fits in a single 9:16 crop.
    """
    if not keyframes:
        return []
    groups = _groups(samples, words, src_aspect)

    # One-person segments follow the keyframes; split segments replace them
    # for their time range.
    segments: list[Segment] = []
    t = 0.0
    for g_start, g_end, people in groups + [(duration, duration, ())]:
        segments += _single(keyframes, t, g_start)
        if people:
            segments.append(Segment(g_start, g_end, people))
        t = g_end
    return [s for s in segments if s.end - s.start > 1 / FPS]


def _single(keyframes, start: float, end: float) -> list[Segment]:
    out = []
    for i, (t, x) in enumerate(keyframes):
        nxt = keyframes[i + 1][0] if i + 1 < len(keyframes) else float("inf")
        a, b = max(t if i else 0.0, start), min(nxt, end)
        if b > a:
            out.append(Segment(a, b, (Person(x, 0.4, 0.2),)))
    return out


def _groups(samples, words, src_aspect: float) -> list[tuple[float, float, tuple[Person, ...]]]:
    """[(start, end, people)] for moments that need a split screen."""
    cuts = [s.t for s in samples if s.cut]
    pieces = speech_pieces(speech_spans(words), cuts)
    if not pieces:
        return []

    rest: dict[int, float] = {}
    by_track: dict[int, list[float]] = {}
    for s in samples:
        for f in s.faces:
            if f.activity is not None:
                by_track.setdefault(f.track, []).append(f.activity)
    for k, v in by_track.items():
        rest[k] = _percentile(v, 0.25)

    # Who talks in each piece, and who the winner is.
    scored = []
    for a, b in pieces:
        inside = [s for s in samples if a <= s.t < b] or [
            min(samples, key=lambda s: abs(s.t - (a + b) / 2))
        ]
        score: dict[int, float] = {}
        where: dict[int, list] = {}
        for s in inside:
            for f in s.faces:
                score[f.track] = score.get(f.track, 0.0) + (f.activity or 0.0) / len(inside)
                where.setdefault(f.track, []).append(f)
        if not score:
            scored.append((a, b, None, set(), where))
            continue
        best = max(score, key=lambda k: score[k])
        active = {
            k
            for k, v in score.items()
            if v >= ACTIVE_SHARE * score[best]
            and v >= ACTIVE_OVER_REST * rest.get(k, 0.0) + ACTIVE_FLOOR
        }
        active.add(best)
        scored.append((a, b, best, active, where))

    # Add people who won a turn shortly before or after: a quick exchange.
    wanted = []
    for a, b, best, active, where in scored:
        members = set(active)
        near = [
            best2
            for a2, _b2, best2, _act2, _w2 in scored
            if best2 is not None and abs(a2 - a) <= EXCHANGE_SECONDS and best2 in where
        ]
        # A single interjection is not an exchange; two turns or more are.
        members |= {k for k in near if near.count(k) >= 2}
        if len(members) > 4:
            members = set(sorted(members, key=lambda k: -len(where.get(k, [])))[:4])
        wanted.append((a, b, best, frozenset(members), where))

    # Runs of the same group; keep only splits that last.
    runs: list[list] = []
    for a, b, best, members, where in wanted:
        if runs and runs[-1][2] == members:
            runs[-1][1] = b
            runs[-1][3].append((best, where))
        else:
            runs.append([a, b, members, [(best, where)]])
    out = []
    for a, b, members, parts in runs:
        if len(members) < 2 or b - a < MIN_SPLIT_SECONDS - 1e-6:
            continue
        people = _people(members, parts)
        if _fits_one_crop(people, src_aspect):
            continue
        out.append((a, b, people))
    return _merge(out)


def _people(members, parts) -> tuple[Person, ...]:
    """The group's faces, left to right, with the run's main speaker first
    when there are three (they get the top row)."""
    seen: dict[int, list] = {}
    wins: dict[int, int] = {}
    for best, where in parts:
        if best is not None:
            wins[best] = wins.get(best, 0) + 1
        for k in members:
            seen.setdefault(k, []).extend(where.get(k, []))

    def med(values):
        return _percentile(values, 0.5)

    people = {
        k: Person(med([f.x for f in fs]), med([f.y for f in fs]), med([f.h for f in fs]))
        for k, fs in seen.items()
        if fs
    }
    order = sorted(people, key=lambda k: people[k].x)
    if len(order) == 3:
        main = max(order, key=lambda k: wins.get(k, 0))
        order = [main] + [k for k in order if k != main]
    return tuple(people[k] for k in order)


def _fits_one_crop(people: tuple[Person, ...], src_aspect: float) -> bool:
    crop_share = (9 / 16) / src_aspect  # 9:16 crop width as a share of the frame
    xs = [p.x for p in people]
    return max(xs) - min(xs) <= FITS_SHARE * crop_share


def _merge(groups):
    """Close tiny gaps between splits with the same people."""
    out: list = []
    for a, b, people in groups:
        if out and out[-1][2] == people and a - out[-1][1] < MIN_SPLIT_SECONDS:
            out[-1] = (out[-1][0], b, people)
        else:
            out.append((a, b, people))
    return out


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


def _tiles(n: int) -> list[tuple[int, int, int, int]]:
    """(x, y, w, h) of each tile on the 1080 x 1920 canvas."""
    half_w, half_h = OUT_W // 2, OUT_H // 2
    if n == 1:
        return [(0, 0, OUT_W, OUT_H)]
    if n == 2:
        return [(0, 0, OUT_W, half_h), (0, half_h, OUT_W, half_h)]
    if n == 3:
        return [
            (0, 0, OUT_W, half_h),
            (0, half_h, half_w, half_h),
            (half_w, half_h, half_w, half_h),
        ]
    return [(x, y, half_w, half_h) for y in (0, half_h) for x in (0, half_w)]


def _crop_box(p: Person, tw: int, th: int, src_w: int, src_h: int, full: bool):
    """Source region (x, y, w, h) with the tile's aspect, framed on the face."""
    aspect = tw / th
    if full:
        ch = src_h
    else:
        # Head and shoulders: about 3.2 face heights tall.
        ch = min(src_h, max(p.h * src_h * 3.2, src_h * 0.35))
    cw = ch * aspect
    if cw > src_w:
        cw, ch = src_w, src_w / aspect
    cx = p.x * src_w - cw / 2
    cy = p.y * src_h - ch * 0.4  # face a little above the middle
    cx = min(max(cx, 0), src_w - cw)
    cy = min(max(cy, 0), src_h - ch)

    def even(v):
        return int(v) // 2 * 2

    return even(cx), even(cy), even(cw), even(ch)


def layout_filter(segments: list[Segment], src_w: int, src_h: int) -> Reframe:
    """One graph that trims [in] into segments, lays each out, and joins them."""
    n = len(segments)
    parts = [f"[in]fps={FPS},split={n}" + "".join(f"[s{i}]" for i in range(n))]
    for i, seg in enumerate(segments):
        a = round(seg.start * FPS) / FPS
        b = round(seg.end * FPS) / FPS
        head = f"[s{i}]trim=start={a:.4f}:end={b:.4f},setpts=PTS-STARTPTS"
        tiles = _tiles(len(seg.people))
        if len(tiles) == 1:
            x, y, w, h = _crop_box(seg.people[0], OUT_W, OUT_H, src_w, src_h, full=True)
            parts.append(f"{head},crop={w}:{h}:{x}:{y},scale={OUT_W}:{OUT_H},setsar=1[v{i}]")
            continue
        names = [f"[t{i}_{j}]" for j in range(len(tiles))]
        parts.append(
            f"{head},split={len(tiles)}" + "".join(f"[r{i}_{j}]" for j in range(len(tiles)))
        )
        for j, (p, (_tx, _ty, tw, th)) in enumerate(zip(seg.people, tiles, strict=True)):
            x, y, w, h = _crop_box(p, tw, th, src_w, src_h, full=False)
            parts.append(f"[r{i}_{j}]crop={w}:{h}:{x}:{y},scale={tw}:{th},setsar=1{names[j]}")
        layout = "|".join(f"{tx}_{ty}" for tx, ty, _w, _h in tiles)
        parts.append(f"{''.join(names)}xstack=inputs={len(tiles)}:layout={layout}[v{i}]")
    parts.append("".join(f"[v{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=0[out]")
    return Reframe(";".join(parts), OUT_W, OUT_H)
