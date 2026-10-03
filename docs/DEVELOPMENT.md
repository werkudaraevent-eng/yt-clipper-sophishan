# Development

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js 15 app (UI + API routes), deployed to Vercel |
| `packages/shared` | Job options schema (zod) and status enums shared with the web app |
| `services/worker` | Python worker that claims jobs from Postgres and runs the clip pipeline |
| `supabase/migrations` | Database schema, RLS policies and job-queue functions |
| `fixtures` | Job-option fixtures both the TS and Python schemas are tested against |

## Quick start (queue + worker + web)

```bash
cp .env.example .env
docker compose up --build
```

This starts Postgres with the migrations applied (via a small `auth` stub, see
`supabase/dev/auth_stub.sql`), the worker, and the web dev server on
http://localhost:3000. Insert a project to watch the worker pick it up:

```bash
psql postgresql://postgres:postgres@localhost:5432/postgres <<'SQL'
insert into auth.users (id, email) values (gen_random_uuid(), 'me@example.com');
insert into public.projects (user_id, youtube_url, options)
select id, 'https://youtu.be/arj7oStGLkU',
       '{"youtubeUrl":"https://youtu.be/arj7oStGLkU","timeframe":{"start":0,"end":600}}'
from auth.users limit 1;
SQL
docker compose logs -f worker
```

The worker downloads the timeframe, picks highlights with Claude (needs
`ANTHROPIC_API_KEY` in `.env`) and writes the clips to `/work/<project id>/` in the `worker-work` volume.
Uploading them to Supabase Storage comes with the web app in M2.

## Clip engine CLI

The same pipeline the worker runs, without a database:

```bash
cd services/worker
python -m venv .venv && .venv/bin/pip install -e '.[dev,asr]'
export ANTHROPIC_API_KEY=...            # or pass --offline (density heuristic, dev only)
.venv/bin/clipper "https://www.youtube.com/watch?v=arj7oStGLkU" --end 600 \
    --length 30to60 --template karaoke --layout auto --out ./out
```

### Using an LLM gateway (9Router and similar)

The worker talks to any gateway with an OpenAI-compatible
`/v1/chat/completions` endpoint, which 9Router exposes for every model it
routes. Set:

```bash
export CLIPPER_LLM_BASE_URL=https://your-gateway.example  # a trailing /v1 is stripped
export CLIPPER_LLM_API_KEY=...                            # the gateway's API key (Bearer); omit if a proxy injects it
export CLIPPER_LLM_MODEL=...                              # a model or combo name the gateway routes
```

In gateway mode the worker spells the clip schema out in the prompt and reads
the JSON from the reply text, because 9Router drops tools and `response_format`
for some providers (and answers even `/v1/messages` in OpenAI format). The gateway must be reachable from wherever the
worker runs: a tunnel to a laptop works for testing, but jobs fail whenever
the laptop sleeps.

Or from a local file plus word timings (`[{"text","start","end"}, ...]`):

```bash
.venv/bin/clipper --video talk.mp4 --words talk.words.json --language en --end 300 --out ./out
```

Each run writes `clip-NN.mp4`, `clip-NN.jpg`, the `.ass` caption file and a
`manifest.json` with titles, hooks, scores and timings.

Pipeline stages (`clipper_worker/engine/`):

| Stage | Module | Notes |
|---|---|---|
| download | `youtube.py` | yt-dlp metadata, json3 caption track, section download (H.264 ≤1080p). `YTDLP_COOKIES_FILE` / `YTDLP_PROXY` for servers YouTube blocks |
| transcribe | `transcript.py` | Word timings from faster-whisper on the downloaded audio (`asr` extra, `CLIPPER_WHISPER_MODEL`, default `large-v3-turbo`); YouTube captions are the fallback. `CLIPPER_TRANSCRIBER=youtube` uses the captions first, as before |
| analyze | `highlights.py` | Claude with structured output (`CLIPPER_LLM_MODEL`, default `claude-opus-5`) and server-side refusal fallback; clips are snapped to word edges and checked for length/overlap |
| render | `reframe.py`, `captions.py`, `render.py` | One FFmpeg pass: reframe (Auto = YuNet face tracking via `CLIPPER_FACE_MODEL`, Haar fallback), ASS captions + hook title, x264/AAC |

## Full Supabase stack (auth, storage)

Install the [Supabase CLI](https://supabase.com/docs/guides/local-development), then:

```bash
supabase start          # applies supabase/migrations
pnpm install
pnpm dev                # web on :3000
cd services/worker && DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres python -m clipper_worker
```

## Checks (same as CI)

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm --filter web build

cd services/worker
python -m venv .venv && .venv/bin/pip install -e '.[dev]'
.venv/bin/ruff check . && .venv/bin/ruff format --check .
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres .venv/bin/pytest
```

Queue and RLS tests need `TEST_DATABASE_URL` (a Postgres server the tests may
create throwaway databases on) and `psql` on the PATH; without it they are skipped.

## Job queue

A new row in `projects` enqueues a `jobs` row (trigger). Workers call
`claim_job(worker_id)` (`FOR UPDATE SKIP LOCKED`), report with
`report_job_progress`, and end with `finish_job`. Failures retry with
exponential backoff (30s, 60s, ...) up to `max_attempts`; a job whose lock
goes stale for 30 minutes is re-claimed. Only the service role / direct DB
connection may call these functions.
