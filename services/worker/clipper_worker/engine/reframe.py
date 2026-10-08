"""Reframe landscape footage to 9:16 (or 1:1) as FFmpeg filter graphs.

Layouts:
  auto   - crop that stays on whoever is speaking (falls back to centre)
  fill   - centre crop that fills the frame
  fit    - whole frame shown, on a blurred copy of itself
  square - 1:1 centre crop
"""

import os
from dataclasses import dataclass, replace
from pathlib import Path

OUT_W, OUT_H = 1080, 1920
SQUARE = 1080

# Face tracking: sample rate (fast enough to see lips move), and how far the
# face must move (as a fraction of the frame width) before the crop follows it.
SAMPLE_FPS = 6.0
MOVE_THRESHOLD = 0.12
MIN_HOLD_SECONDS = 1.5


@dataclass(frozen=True)
class Reframe:
    filter: str  # takes [in], produces [out]
    width: int
    height: int
    sendcmd: str | None = None  # contents of the sendcmd file, if any


def output_size(layout: str) -> tuple[int, int]:
    return (SQUARE, SQUARE) if layout == "square" else (OUT_W, OUT_H)


def _cover(w: int, h: int) -> str:
    """Scale so the frame covers w x h (then crop)."""
    return f"scale={w}:{h}:force_original_aspect_ratio=increase,setsar=1"


def static_filter(layout: str) -> Reframe:
    w, h = output_size(layout)
    if layout == "fit":
        graph = (
            "[in]split[bg][fg];"
            f"[bg]{_cover(w, h)},crop={w}:{h},boxblur=20:2,eq=brightness=-0.08[bgb];"
            f"[fg]scale={w}:{h}:force_original_aspect_ratio=decrease,setsar=1[fgs];"
            "[bgb][fgs]overlay=(W-w)/2:(H-h)/2[out]"
        )
    else:
        graph = f"[in]{_cover(w, h)},crop={w}:{h}[out]"
    return Reframe(graph, w, h)


def tracking_filter(keyframes: list[tuple[float, float]], src_w: int, src_h: int) -> Reframe:
    """Crop that jumps to each keyframe [(t, x in 0..1)] after scaling to 1920 tall."""
    w, h = OUT_W, OUT_H
    scaled_w = round(src_w * h / src_h / 2) * 2
    if scaled_w <= w or not keyframes:
        return static_filter("fill")

    def x_for(cx: float) -> int:
        return int(min(max(cx * scaled_w - w / 2, 0), scaled_w - w))

    x0 = x_for(keyframes[0][1])
    if len(keyframes) == 1:
        return Reframe(f"[in]scale=-2:{h},setsar=1,crop={w}:{h}:{x0}:0[out]", w, h)
    commands = "\n".join(f"{t:.2f} crop x {x_for(cx)};" for t, cx in keyframes[1:])
    graph = f"[in]scale=-2:{h},setsar=1,sendcmd=f='{{cmds}}',crop={w}:{h}:{x0}:0[out]"
    return Reframe(graph, w, h, sendcmd=commands)


def plan_crops(centers: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Reduce noisy face positions to a few held crop positions.

    A median over neighbouring samples drops single-frame misdetections; the
    crop then only moves when the face has clearly moved and the current
    position has been held long enough, which reads as deliberate cuts
    instead of a jittery pan.
    """
    if not centers:
        return []
    xs = [c for _, c in centers]
    smoothed = []
    for i in range(len(xs)):
        window = sorted(xs[max(0, i - 2) : i + 3])
        smoothed.append(window[len(window) // 2])

    keyframes = [(0.0, smoothed[0])]
    for (t, _), x in zip(centers, smoothed, strict=True):
        last_t, last_x = keyframes[-1]
        if abs(x - last_x) >= MOVE_THRESHOLD and t - last_t >= MIN_HOLD_SECONDS:
            keyframes.append((t, x))
    return keyframes


# ---------------------------------------------------------------------------
# Who is talking
# ---------------------------------------------------------------------------
#
# Following the largest face sends the crop to whoever leans in or laughs
# hardest. Instead the crop follows the person whose mouth moves while the
# transcript says someone is speaking, and it only cuts to someone else once
# that person has clearly been the one talking for a while. A laugh, a shout
# or a one-word reply from someone else is too short to take the crop.

# Speech is scored in pieces this long, so a turn change shows up quickly.
TURN_PIECE_SECONDS = 1.0
# Another person has to win this much speech in a row before the crop moves.
MIN_TURN_SECONDS = 2.0
# ...and has to beat the current speaker's mouth movement by this factor.
SWITCH_MARGIN = 1.4
# The first speaker in a shot is picked on this much speech.
FIRST_PICK_SECONDS = 3.0
# Words further apart than this belong to separate stretches of speech.
SPEECH_GAP_SECONDS = 0.5


@dataclass(frozen=True)
class Face:
    track: int  # same person within one camera shot
    x: float  # face centre, 0..1 of the frame width
    area: float  # fraction of the frame
    activity: float | None  # mouth movement since the previous sample
    y: float = 0.4  # face centre, 0..1 of the frame height
    h: float = 0.2  # face height, 0..1 of the frame height


@dataclass(frozen=True)
class Sample:
    t: float  # seconds from the clip start
    faces: tuple[Face, ...]
    cut: bool = False  # the camera shot changed at this sample


def largest_face_centers(samples: list[Sample]) -> list[tuple[float, float]]:
    """[(t, x)] of the largest face, gaps filled with the last known position."""
    known = [max(s.faces, key=lambda f: f.area).x for s in samples if s.faces]
    if not known:
        return []
    last = known[0]
    out = []
    for s in samples:
        if s.faces:
            last = max(s.faces, key=lambda f: f.area).x
        out.append((s.t, last))
    return out


def speech_pieces(spans: list[tuple[float, float]], cuts: list[float]) -> list[tuple[float, float]]:
    """Speech spans split at camera cuts and into pieces of at most ~1s."""
    pieces = []
    for start, end in spans:
        bounds = [start, *(c for c in cuts if start < c < end), end]
        for a, b in zip(bounds, bounds[1:], strict=False):
            n = max(1, round((b - a) / TURN_PIECE_SECONDS))
            step = (b - a) / n
            pieces += [(a + i * step, a + (i + 1) * step) for i in range(n)]
    return pieces


def speech_spans(words, gap: float = SPEECH_GAP_SECONDS) -> list[tuple[float, float]]:
    """Merge word timings (objects with .start/.end) into stretches of speech."""
    spans: list[list[float]] = []
    for w in sorted(words, key=lambda w: w.start):
        if spans and w.start - spans[-1][1] <= gap:
            spans[-1][1] = max(spans[-1][1], w.end)
        else:
            spans.append([w.start, w.end])
    return [(a, b) for a, b in spans if b > a]


def plan_speaker_crops(samples: list[Sample], words) -> list[tuple[float, float]]:
    """Crop keyframes [(t, x)] that stay on whoever is telling the story.

    Falls back to the largest face when there is no speech to go on or no
    mouth movement could be measured.
    """
    if not any(s.faces for s in samples):
        return []
    measured = any(f.activity is not None for s in samples for f in s.faces)
    cuts = [s.t for s in samples if s.cut]
    pieces = speech_pieces(speech_spans(words), cuts)
    if not measured or not pieces:
        return plan_crops(largest_face_centers(samples))

    keyframes: list[tuple[float, float]] = []

    def show(t: float, x: float) -> None:
        if not keyframes:
            keyframes.append((0.0, x))
        elif abs(x - keyframes[-1][1]) >= 0.01:
            keyframes.append((t, x))

    current: int | None = None
    pending: tuple[int, float, float] | None = None  # (track, since, seconds won)
    cut_iter = iter(s for s in samples if s.cut)
    next_cut = next(cut_iter, None)
    for a, b in pieces:
        # A new shot: the old faces are gone. Show the biggest face until we
        # hear who talks in this shot.
        while next_cut is not None and next_cut.t <= a:
            if next_cut.faces:
                show(next_cut.t, max(next_cut.faces, key=lambda f: f.area).x)
            current, pending = None, None
            next_cut = next(cut_iter, None)

        score, xs, area = _piece_scores(samples, a, b)
        if not score:
            continue  # nobody visible: hold the crop
        best = max(score, key=lambda k: (score[k], area[k]))

        def x_of(track: int, xs: dict[int, list[float]] = xs) -> float:
            v = sorted(xs[track])
            return v[len(v) // 2]

        if current is None:
            # First speaker of a shot: judge on a few seconds, not one piece,
            # since a wrong first pick then has to be out-talked to undo.
            shot_end = next_cut.t if next_cut is not None else float("inf")
            total: dict[int, float] = {}
            for a2, b2 in pieces:
                if a <= a2 < min(a + FIRST_PICK_SECONDS, shot_end):
                    for k, v in _piece_scores(samples, a2, b2)[0].items():
                        total[k] = total.get(k, 0.0) + v * (b2 - a2)
            first = max((k for k in total if k in xs), key=lambda k: total[k], default=best)
            current, pending = first, None
            show(a, x_of(first))
            continue
        if best != current and score[best] > SWITCH_MARGIN * score.get(current, 0.0):
            if pending is None or pending[0] != best:
                pending = (best, a, 0.0)
            pending = (best, pending[1], pending[2] + (b - a))
            if pending[2] >= MIN_TURN_SECONDS - 1e-6:
                current = best
                show(pending[1], x_of(best))
                pending = None
            continue
        pending = None
        # Same speaker: follow them only if they really moved in the frame.
        if current in xs and abs(x_of(current) - keyframes[-1][1]) >= MOVE_THRESHOLD:
            show(a, x_of(current))
    return keyframes


def _piece_scores(samples: list[Sample], a: float, b: float):
    """Mean mouth activity, positions and size of each face over [a, b)."""
    inside = [s for s in samples if a <= s.t < b] or [
        min(samples, key=lambda s: abs(s.t - (a + b) / 2))
    ]
    score: dict[int, float] = {}
    xs: dict[int, list[float]] = {}
    area: dict[int, float] = {}
    for s in inside:
        for f in s.faces:
            score[f.track] = score.get(f.track, 0.0) + (f.activity or 0.0) / len(inside)
            xs.setdefault(f.track, []).append(f.x)
            area[f.track] = max(area.get(f.track, 0.0), f.area)
    return score, xs, area


# ---------------------------------------------------------------------------
# Face detection
# ---------------------------------------------------------------------------

MOUTH_PATCH = (24, 16)  # mouth crops are resized to this before comparing
SCENE_CUT_DIFF = 30.0  # mean grey-level change (0..255) that counts as a cut


@dataclass(frozen=True)
class _Detection:
    x: float
    area: float
    box: tuple[float, float, float, float]  # mouth region in full-frame pixels
    y: float = 0.4
    h: float = 0.2
    # Nose and cheeks: moves with the head and the camera but not with speech.
    ref: tuple[float, float, float, float] | None = None


class FaceDetector:
    """Faces per frame, with the box around each mouth.

    Uses OpenCV's YuNet detector when its model file is present
    (CLIPPER_FACE_MODEL, baked into the worker image), otherwise the Haar
    cascade bundled with OpenCV, which is weaker on profiles and small faces.
    """

    def __init__(self) -> None:
        import cv2

        self.cv2 = cv2
        self._yunet = None
        self._haar = None
        model = os.environ.get("CLIPPER_FACE_MODEL")
        if model and Path(model).exists():
            self._yunet = cv2.FaceDetectorYN.create(model, "", (320, 320), 0.6)
        else:
            cascade = cv2.CascadeClassifier(
                cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
            )
            self._haar = None if cascade.empty() else cascade

    def detect(self, frame) -> list[_Detection]:
        h, w = frame.shape[:2]
        scale = 640 / max(w, h)
        small = self.cv2.resize(frame, (round(w * scale), round(h * scale)))
        out = []
        if self._yunet is not None:
            self._yunet.setInputSize((small.shape[1], small.shape[0]))
            _, faces = self._yunet.detect(small)
            for f in [] if faces is None else faces:
                fx, fy, fw, fh = (v / scale for v in f[:4])
                rx, ry, lx, ly = (v / scale for v in f[10:14])
                mx, my = (rx + lx) / 2, (ry + ly) / 2
                half = max(abs(lx - rx), 0.3 * fw) * 0.75
                box = (mx - half, my - 0.12 * fh, mx + half, my + 0.22 * fh)
                nx, ny = f[8] / scale, f[9] / scale
                ref = (nx - 0.25 * fw, ny - 0.15 * fh, nx + 0.25 * fw, ny + 0.05 * fh)
                out.append(
                    _Detection(
                        float((fx + fw / 2) / w), float(fw * fh / (w * h)), box,
                        float((fy + fh / 2) / h), float(fh / h), ref,
                    )
                )  # fmt: skip
        elif self._haar is not None:
            gray = self.cv2.cvtColor(small, self.cv2.COLOR_BGR2GRAY)
            min_side = small.shape[0] // 12
            for x, y, fw, fh in self._haar.detectMultiScale(
                gray, 1.1, 5, minSize=(min_side, min_side)
            ):
                x, y, fw, fh = (v / scale for v in (x, y, fw, fh))
                box = (x + 0.2 * fw, y + 0.65 * fh, x + 0.8 * fw, y + fh)
                ref = (x + 0.25 * fw, y + 0.4 * fh, x + 0.75 * fw, y + 0.6 * fh)
                out.append(
                    _Detection(
                        float((x + fw / 2) / w), float(fw * fh / (w * h)), box,
                        float((y + fh / 2) / h), float(fh / h), ref,
                    )
                )  # fmt: skip
        return out

    def mouth_patch(self, gray, box):
        """The mouth region, resized and normalised for brightness."""
        import numpy as np

        h, w = gray.shape[:2]
        x0, y0, x1, y1 = (
            int(max(0, box[0])), int(max(0, box[1])), int(min(w, box[2])), int(min(h, box[3]))
        )  # fmt: skip
        if x1 - x0 < 4 or y1 - y0 < 4:
            return None
        patch = self.cv2.resize(gray[y0:y1, x0:x1], MOUTH_PATCH).astype(np.float32)
        return (patch - patch.mean()) / (patch.std() + 8.0)


def face_track(video: Path, start: float, end: float) -> tuple[list[Sample], int, int]:
    """Faces sampled ~6x a second (t relative to start) plus the source size.

    Faces are linked into tracks by position within one camera shot, and each
    gets how much its mouth changed since the previous sample.
    """
    import cv2
    import numpy as np

    cap = cv2.VideoCapture(str(video))
    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, round(fps / SAMPLE_FPS))
    detector = FaceDetector()
    samples: list[Sample] = []
    # track -> (last x, (mouth, nose) patches at the previous sample or None)
    tracks: dict[int, tuple[float, object]] = {}
    next_track = 0
    prev_thumb = None
    try:
        # One seek, then decode sequentially and look at every `step`-th frame.
        cap.set(cv2.CAP_PROP_POS_MSEC, start * 1000)
        index = 0
        while True:
            if not cap.grab():
                break
            t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
            if t >= end:
                break
            if index % step == 0:
                ok, frame = cap.retrieve()
                if ok:
                    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                    thumb = cv2.resize(gray, (64, 36)).astype(np.float32)
                    cut = prev_thumb is not None and (
                        float(np.abs(thumb - prev_thumb).mean()) > SCENE_CUT_DIFF
                    )
                    prev_thumb = thumb
                    if cut:
                        tracks = {}
                    faces = []
                    seen: dict[int, tuple[float, object]] = {}
                    detections = sorted(detector.detect(frame), key=lambda d: -d.area)
                    for d in detections:
                        reach = max(0.06, 1.2 * d.area**0.5)
                        free = [k for k in tracks if k not in seen]
                        near = min(free, key=lambda k: abs(tracks[k][0] - d.x), default=None)
                        if near is None or abs(tracks[near][0] - d.x) > reach:
                            near, next_track = next_track, next_track + 1
                            before = None
                        else:
                            before = tracks[near][1]
                        mouth = detector.mouth_patch(gray, d.box)
                        nose = detector.mouth_patch(gray, d.ref) if d.ref else None
                        patch = None if mouth is None else (mouth, nose)
                        activity = None
                        if patch is not None and before is not None:
                            activity = float(np.abs(mouth - before[0]).mean())
                            # Head turns, nods and camera moves change the
                            # whole face; only mouth change beyond that counts.
                            if nose is not None and before[1] is not None:
                                head = float(np.abs(nose - before[1]).mean())
                                activity = max(0.0, activity - 0.8 * head)
                        seen[near] = (d.x, patch)
                        faces.append(Face(near, d.x, d.area, activity, d.y, d.h))
                    # Faces not seen now keep their place but lose their mouth
                    # crop, so a later sample isn't compared with a stale one.
                    for k, (x, _) in tracks.items():
                        if k not in seen:
                            seen[k] = (x, None)
                    tracks = seen
                    samples.append(Sample(max(0.0, t - start), tuple(faces), cut))
            index += 1
    finally:
        cap.release()
    return samples, src_w, src_h


# ---------------------------------------------------------------------------
# Matching lips to the voice
# ---------------------------------------------------------------------------
#
# Mouth movement alone can't tell a talker from a listener who smiles, nods
# or laughs. The talker's mouth moves *with* the voice: it opens as the sound
# gets louder and closes in the small pauses between phrases. So each face's
# mouth movement is weighted by how well it follows the loudness of the audio
# over the few seconds around it.

SYNC_WINDOW_SECONDS = 3.0  # on each side of a sample
SYNC_MIN_SAMPLES = 8
SYNC_BASE = 0.3  # weight of a face whose lips don't follow the voice at all


def audio_envelope(video: Path, start: float, end: float, times: list[float]) -> list[float] | None:
    """Loudness (log RMS) of the audio around each of `times` (seconds from
    `start`), or None when the video has no audio."""
    import subprocess

    import numpy as np

    rate = 8000
    proc = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-ss", f"{start:.3f}",
         "-t", f"{end - start:.3f}", "-i", str(video), "-vn", "-ac", "1",
         "-ar", str(rate), "-f", "s16le", "-"],
        capture_output=True,
    )  # fmt: skip
    if proc.returncode != 0 or not proc.stdout:
        return None
    pcm = np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768
    half = int(rate / SAMPLE_FPS / 2)
    out = []
    for t in times:
        mid = int(t * rate)
        chunk = pcm[max(0, mid - half) : mid + half]
        rms = float(np.sqrt(np.mean(chunk**2))) if len(chunk) else 0.0
        out.append(float(np.log10(rms + 1e-4)))
    return out


def _corr(a: list[float], b: list[float]) -> float:
    n = len(a)
    ma, mb = sum(a) / n, sum(b) / n
    cov = sum((x - ma) * (y - mb) for x, y in zip(a, b, strict=True))
    va = sum((x - ma) ** 2 for x in a)
    vb = sum((y - mb) ** 2 for y in b)
    return cov / (va * vb) ** 0.5 if va > 0 and vb > 0 else 0.0


def sync_with_audio(samples: list[Sample], envelope: list[float] | None) -> list[Sample]:
    """Samples whose face activity is weighted by lip-voice agreement."""
    if not envelope or len(envelope) != len(samples):
        return samples
    series: dict[int, list[tuple[float, float, float]]] = {}  # track -> [(t, act, loud)]
    for s, loud in zip(samples, envelope, strict=True):
        for f in s.faces:
            if f.activity is not None:
                series.setdefault(f.track, []).append((s.t, f.activity, loud))

    def weight(track: int, t: float) -> float:
        near = [(a, v) for ts, a, v in series.get(track, []) if abs(ts - t) <= SYNC_WINDOW_SECONDS]
        if len(near) < SYNC_MIN_SAMPLES:
            return SYNC_BASE + 0.2  # not enough to judge: in between
        r = _corr([a for a, _ in near], [v for _, v in near])
        return SYNC_BASE + max(0.0, r)

    out = []
    for s in samples:
        faces = tuple(
            f if f.activity is None else replace(f, activity=f.activity * weight(f.track, s.t))
            for f in s.faces
        )
        out.append(replace(s, faces=faces))
    return out
