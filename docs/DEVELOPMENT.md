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

In M0 the pipeline is a dry run that only walks the stages; M1 makes it real.

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
