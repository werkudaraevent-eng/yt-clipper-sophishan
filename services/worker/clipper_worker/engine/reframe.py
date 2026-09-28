"""Reframe landscape footage to 9:16 (or 1:1) as FFmpeg filter graphs.

Layouts:
  auto   - crop that follows the main speaker's face (falls back to centre)
  fill   - centre crop that fills the frame
  fit    - whole frame shown, on a blurred copy of itself
  square - 1:1 centre crop
"""

import os
from dataclasses import dataclass
from pathlib import Path

OUT_W, OUT_H = 1080, 1920
SQUARE = 1080

# Face tracking: sample rate, and how far the face must move (as a fraction of
# the crop width) before the crop jumps to follow it.
SAMPLE_FPS = 3.0
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


def tracking_filter(centers: list[tuple[float, float]], src_w: int, src_h: int) -> Reframe:
    """Crop that jumps to follow `centers` [(t, x in 0..1)] after scaling to 1920 tall."""
    w, h = OUT_W, OUT_H
    scaled_w = round(src_w * h / src_h / 2) * 2
    if scaled_w <= w or not centers:
        return static_filter("fill")

    def x_for(cx: float) -> int:
        return int(min(max(cx * scaled_w - w / 2, 0), scaled_w - w))

    keyframes = plan_crops(centers)
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
# Face detection
# ---------------------------------------------------------------------------


class FaceDetector:
    """Largest-face centre per frame.

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

    def center_x(self, frame) -> float | None:
        h, w = frame.shape[:2]
        scale = 640 / max(w, h)
        small = self.cv2.resize(frame, (round(w * scale), round(h * scale)))
        if self._yunet is not None:
            self._yunet.setInputSize((small.shape[1], small.shape[0]))
            _, faces = self._yunet.detect(small)
            boxes = [] if faces is None else [(f[2] * f[3], f[0] + f[2] / 2) for f in faces]
        elif self._haar is not None:
            gray = self.cv2.cvtColor(small, self.cv2.COLOR_BGR2GRAY)
            min_side = small.shape[0] // 12
            faces = self._haar.detectMultiScale(gray, 1.1, 5, minSize=(min_side, min_side))
            boxes = [(fw * fh, x + fw / 2) for x, _y, fw, fh in faces]
        else:
            return None
        if not boxes:
            return None
        return float(max(boxes)[1] / small.shape[1])


def face_track(video: Path, start: float, end: float) -> tuple[list[tuple[float, float]], int, int]:
    """[(t relative to start, face centre x 0..1)] plus the source size."""
    import cv2

    cap = cv2.VideoCapture(str(video))
    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, round(fps / SAMPLE_FPS))
    detector = FaceDetector()
    samples: list[tuple[float, float | None]] = []
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
                    samples.append((max(0.0, t - start), detector.center_x(frame)))
            index += 1
    finally:
        cap.release()

    # Fill gaps (no face found) with the last known position, or the first one.
    known = [x for _, x in samples if x is not None]
    if not known:
        return [], src_w, src_h
    last = known[0]
    filled = []
    for ts, x in samples:
        last = x if x is not None else last
        filled.append((ts, last))
    return filled, src_w, src_h
