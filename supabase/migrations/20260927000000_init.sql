-- Initial schema: profiles, projects, jobs (queue), clips, caption templates,
-- credit ledger. See docs/PRD.md §8.

create extension if not exists pgcrypto;

create type project_status as enum ('queued', 'processing', 'ready', 'failed', 'expired');
create type job_status as enum ('queued', 'running', 'succeeded', 'failed');
create type plan_tier as enum ('free', 'pro', 'business');

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user, created by trigger
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  plan plan_tier not null default 'free',
  credits_remaining integer not null default 30 check (credits_remaining >= 0),
  ui_language text not null default 'en',
  created_at timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- projects: one YouTube video + the options chosen on the Create page
-- ---------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  youtube_url text not null,
  youtube_id text,
  title text,
  thumbnail_url text,
  duration_seconds integer,
  video_language text,
  options jsonb not null,
  status project_status not null default 'queued',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '60 days'
);

create index projects_user_created_idx on public.projects (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- jobs: Postgres-backed work queue, claimed with FOR UPDATE SKIP LOCKED
-- ---------------------------------------------------------------------------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null default 'process_project',
  status job_status not null default 'queued',
  stage text,
  progress real not null default 0 check (progress between 0 and 1),
  attempt integer not null default 0,
  max_attempts integer not null default 3,
  error text,
  locked_by text,
  locked_at timestamptz,
  run_after timestamptz not null default now(),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index jobs_claimable_idx on public.jobs (run_after) where status = 'queued';
create index jobs_project_idx on public.jobs (project_id);

-- Every new project gets a processing job.
create function public.enqueue_project_job() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.jobs (project_id) values (new.id);
  return new;
end;
$$;

create trigger on_project_created
  after insert on public.projects
  for each row execute function public.enqueue_project_job();

-- Claim the next runnable job. Running jobs whose lock is older than
-- `stale_after` are treated as abandoned (worker crashed) and re-claimed.
create function public.claim_job(worker_id text, stale_after interval default interval '30 minutes')
returns setof public.jobs
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.jobs j
     set status = 'running',
         attempt = j.attempt + 1,
         locked_by = worker_id,
         locked_at = now(),
         error = null
   where j.id = (
     select id from public.jobs
      where attempt < max_attempts
        and ((status = 'queued' and run_after <= now())
          or (status = 'running' and locked_at < now() - stale_after))
      order by run_after
      limit 1
      for update skip locked
   )
  returning j.*;
end;
$$;

create function public.report_job_progress(job_id uuid, worker_id text, new_stage text, new_progress real)
returns void
language sql security definer set search_path = public as $$
  update public.jobs
     set stage = new_stage, progress = new_progress, locked_at = now()
   where id = job_id and locked_by = worker_id and status = 'running';
$$;

-- Finish a job. On failure the job is retried with backoff until
-- max_attempts is reached; only then does the project turn 'failed'.
create function public.finish_job(job_id uuid, worker_id text, succeeded boolean, error_message text default null)
returns public.jobs
language plpgsql security definer set search_path = public as $$
declare
  j public.jobs;
begin
  select * into j from public.jobs where id = job_id and locked_by = worker_id for update;
  if not found then
    raise exception 'job % is not locked by %', job_id, worker_id;
  end if;

  if succeeded then
    update public.jobs set status = 'succeeded', progress = 1, finished_at = now(), locked_by = null
     where id = job_id returning * into j;
    update public.projects set status = 'ready', error = null, updated_at = now() where id = j.project_id;
  elsif j.attempt >= j.max_attempts then
    update public.jobs set status = 'failed', error = error_message, finished_at = now(), locked_by = null
     where id = job_id returning * into j;
    update public.projects set status = 'failed', error = error_message, updated_at = now() where id = j.project_id;
  else
    update public.jobs
       set status = 'queued', error = error_message, locked_by = null, locked_at = null,
           run_after = now() + make_interval(secs => 30 * power(2, j.attempt - 1))
     where id = job_id returning * into j;
  end if;
  return j;
end;
$$;

-- Keep the project status in step when a worker starts on it.
create function public.mark_project_processing() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'running' and old.status is distinct from 'running' then
    update public.projects set status = 'processing', updated_at = now()
     where id = new.project_id and status in ('queued', 'processing');
  end if;
  return new;
end;
$$;

create trigger on_job_running
  after update of status on public.jobs
  for each row execute function public.mark_project_processing();

-- ---------------------------------------------------------------------------
-- clips: the rendered shorts
-- ---------------------------------------------------------------------------
create table public.clips (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  position integer not null,
  start_seconds real not null,
  end_seconds real not null check (end_seconds > start_seconds),
  title text,
  hook_text text,
  description text,
  virality_score real,
  reason text,
  video_path text,
  thumbnail_path text,
  caption_words jsonb,
  created_at timestamptz not null default now(),
  unique (project_id, position)
);

-- ---------------------------------------------------------------------------
-- caption templates (readable by everyone, managed by service role)
-- ---------------------------------------------------------------------------
create table public.caption_templates (
  id text primary key,
  name text not null,
  config jsonb not null,
  preview_url text,
  sort_order integer not null default 0
);

insert into public.caption_templates (id, name, config, sort_order) values
  ('karaoke', 'Karaoke', '{"font":"Montserrat ExtraBold","uppercase":true,"primary":"#FFFFFF","highlight":"#22FF22","outline":4}', 1),
  ('box', 'Box', '{"font":"Montserrat ExtraBold","uppercase":true,"primary":"#FFFFFF","highlightBox":"#E0245E","outline":0}', 2),
  ('ali', 'Ali', '{"font":"Poppins SemiBold","uppercase":false,"primary":"#111111","background":"#FFFFFF","dimmed":"#9CA3AF"}', 3);

-- ---------------------------------------------------------------------------
-- credit ledger (append-only; profiles.credits_remaining is the cached sum)
-- ---------------------------------------------------------------------------
create table public.credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  delta integer not null,
  reason text not null,
  project_id uuid references public.projects (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.jobs enable row level security;
alter table public.clips enable row level security;
alter table public.caption_templates enable row level security;
alter table public.credit_ledger enable row level security;

create policy "own profile: read" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "own profile: update" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "own projects: read" on public.projects
  for select to authenticated using (user_id = auth.uid());
create policy "own projects: create" on public.projects
  for insert to authenticated with check (user_id = auth.uid() and status = 'queued');
create policy "own projects: delete" on public.projects
  for delete to authenticated using (user_id = auth.uid());

create policy "own jobs: read" on public.jobs
  for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));

create policy "own clips: read" on public.clips
  for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));

create policy "templates: read" on public.caption_templates
  for select to anon, authenticated using (true);

create policy "own ledger: read" on public.credit_ledger
  for select to authenticated using (user_id = auth.uid());

-- Only the worker (service role / direct DB connection) may drive the queue.
revoke execute on function public.claim_job(text, interval) from public, anon, authenticated;
revoke execute on function public.report_job_progress(uuid, text, text, real) from public, anon, authenticated;
revoke execute on function public.finish_job(uuid, text, boolean, text) from public, anon, authenticated;
