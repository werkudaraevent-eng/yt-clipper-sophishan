FROM python:3.12-slim

# FFmpeg for cutting/encoding (M1), psql client for applying dev migrations.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg postgresql-client \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml ./
COPY clipper_worker ./clipper_worker
RUN pip install --no-cache-dir .

RUN useradd --create-home clipper
USER clipper

CMD ["python", "-m", "clipper_worker"]
