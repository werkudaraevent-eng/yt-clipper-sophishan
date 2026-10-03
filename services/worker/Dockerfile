FROM python:3.12-slim

# FFmpeg (with libass) for cutting and captions, Montserrat for caption
# templates, psql client for applying dev migrations.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-montserrat postgresql-client curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# YuNet face detector (OpenCV Zoo, MIT) for the Auto layout.
ARG YUNET_URL=https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
ARG YUNET_SHA256=8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4
RUN mkdir -p /opt/models \
 && curl -fsSL -o /opt/models/yunet.onnx "$YUNET_URL" \
 && echo "$YUNET_SHA256  /opt/models/yunet.onnx" | sha256sum -c -

WORKDIR /app
COPY pyproject.toml ./
COPY clipper_worker ./clipper_worker
RUN pip install --no-cache-dir '.[asr]'

# HF_HOME: Whisper models (about 1.6 GB) live on the work volume, so they are
# downloaded once instead of after every rebuild.
ENV CLIPPER_FACE_MODEL=/opt/models/yunet.onnx \
    CLIPPER_FONTS_DIR=/usr/share/fonts \
    CLIPPER_WORK_DIR=/work \
    HF_HOME=/work/.models

RUN useradd --create-home clipper && mkdir -p /work && chown clipper /work
USER clipper

CMD ["python", "-m", "clipper_worker"]
