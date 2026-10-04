-- Clip editor.
--
-- Anyone can fix the caption text and the hook of a finished clip. Credit
-- buyers can also move its start and end (up to 30 s past the AI's cut), turn
-- the cold open on or off and change its look. A saved edit becomes a
-- 'rerender_clip' job: the worker downloads that part of the video again,
-- renders it with the edit and overwrites the clip's files in place, so links
-- to them (scheduled posts included) keep working.
--
-- Buyers also keep a name dictionary ("Mateus Kunya" is "Matheus Cunha") that
-- the worker applies to the captions of their next videos.

-- ---------------------------------------------------------------------------
-- clips: how the current file was rendered, and the AI's original cut
-- ---------------------------------------------------------------------------

-- What the clip's file was rendered with: {template, position,
-- wordsPerCaption, layout, hookTitle, coldOpen, teaser: [start, end] | null}.
-- The teaser (the cold open's place in the video) is kept while the cold open
-- is off, so it can be turned back on. Null for clips rendered before this
-- migration; the worker then starts from the project's options.
alter table public.clips
  add column render jsonb,
  -- The AI's cut, set on the first trim; trims stay within 30 s of it.
  add column original_start real,
  add column original_end real,
  add column edited_at timestamptz;

-- ---------------------------------------------------------------------------
-- jobs: a re-render names its clip and carries the edit
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column clip_id uuid references public.clips (id) on delete cascade,
  add column payload jsonb;

create index jobs_clip_idx on public.jobs (clip_id) where clip_id is not null;

-- A re-render never changes the project's status: it stays ready while the
-- clip is redone, and a failed re-render must not fail (and refund) it.
create or replace function public.finish_job(job_id uuid, worker_id text, succeeded boolean, error_message text default null)
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
    if j.kind = 'process_project' then
      update public.projects set status = 'ready', error = null, updated_at = now() where id = j.project_id;
    end if;
  elsif j.attempt >= j.max_attempts then
    update public.jobs set status = 'failed', error = error_message, finished_at = now(), locked_by = null
     where id = job_id returning * into j;
    if j.kind = 'process_project' then
      update public.projects set status = 'failed', error = error_message, updated_at = now() where id = j.project_id;
    end if;
  else
    update public.jobs
       set status = 'queued', error = error_message, locked_by = null, locked_at = null,
           run_after = now() + make_interval(secs => 30 * power(2, j.attempt - 1))
     where id = job_id returning * into j;
  end if;
  return j;
end;
$$;

revoke execute on function public.finish_job(uuid, text, boolean, text) from public, anon, authenticated;

-- Same lanes as before; inside a lane a re-render (a minute or two) goes
-- before a whole video, so a caption fix does not wait behind a long render.
create or replace function public.claim_job(worker_id text, stale_after interval default interval '30 minutes')
returns setof public.jobs
language plpgsql security definer set search_path = public as $$
declare
  free_turn boolean;
begin
  select count(*) filter (where last.priority) = 2 into free_turn
    from (
      select priority from public.jobs
       where started_at is not null
       order by started_at desc
       limit 2
    ) last;

  return query
  update public.jobs j
     set status = 'running',
         attempt = j.attempt + 1,
         locked_by = worker_id,
         locked_at = now(),
         started_at = now(),
         priority = pick.priority,
         error = null
    from (
      select c.id, lane.priority
        from public.jobs c
        join public.projects p on p.id = c.project_id
        cross join lateral (select private.is_priority(p.user_id) as priority) lane
       where c.attempt < c.max_attempts
         and ((c.status = 'queued' and c.run_after <= now())
           or (c.status = 'running' and c.locked_at < now() - stale_after))
       order by (lane.priority <> free_turn) desc, (c.kind = 'rerender_clip') desc, c.run_after
       limit 1
       for update of c skip locked
    ) pick
   where j.id = pick.id
  returning j.*;
end;
$$;

revoke execute on function public.claim_job(text, interval) from public, anon, authenticated;

-- The waiting card counts whole videos only: re-renders are short, and their
-- run times would drag the average (and so the estimate) down.
create or replace function public.queue_position(p_project_id uuid)
returns table (
  place integer,
  workers integer,
  avg_seconds integer,
  eta_seconds integer,
  priority boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  mine public.jobs;
  mine_priority boolean;
  same_ahead integer;
  other_total integer;
  n_ahead integer;
  n_workers integer;
  avg_s double precision;
begin
  select j.* into mine
    from public.jobs j join public.projects p on p.id = j.project_id
   where j.project_id = p_project_id and p.user_id = auth.uid() and j.kind = 'process_project'
     and j.status = 'queued' and j.attempt < j.max_attempts
   order by j.created_at desc
   limit 1;
  if not found then
    return;
  end if;
  mine_priority := private.is_priority(auth.uid());

  select count(*) filter (where q.lane = mine_priority and (q.run_after, q.id) < (mine.run_after, mine.id)),
         count(*) filter (where q.lane <> mine_priority)
    into same_ahead, other_total
    from (
      select j.id, j.run_after, private.is_priority(p.user_id) as lane
        from public.jobs j join public.projects p on p.id = j.project_id
       where j.status = 'queued' and j.attempt < j.max_attempts and j.id <> mine.id
         and j.kind = 'process_project'
    ) q;

  if mine_priority then
    n_ahead := same_ahead + least(other_total, same_ahead / 2);
  else
    n_ahead := same_ahead + least(other_total, 2 * (same_ahead + 1));
  end if;

  select greatest(count(*), 1) into n_workers
    from public.jobs
   where status = 'running' and locked_at > now() - interval '30 minutes';

  select coalesce(extract(epoch from avg(finished_at - started_at)), 600) into avg_s
    from public.jobs
   where status = 'succeeded' and started_at is not null and kind = 'process_project'
     and finished_at > now() - interval '24 hours';

  place := n_ahead + 1;
  workers := n_workers;
  avg_seconds := round(avg_s);
  eta_seconds := round(avg_s * (0.5 + floor(n_ahead::numeric / n_workers)));
  priority := mine_priority;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- edit_clip: queue a re-render of one clip
-- ---------------------------------------------------------------------------

-- How far a trim may move the clip past the AI's cut, and its length limits.
-- Active re-renders per user are capped so one account cannot fill the queue.
--
-- p_edit holds only what changed:
--   words  [{text, start, end}] the captions over the clip's current range,
--          video seconds (anyone)
--   hook   the hook title (anyone)
--   start, end  new cut in video seconds (buyers)
--   style  {template, position, wordsPerCaption, layout, hookTitle, coldOpen}
--          (buyers)
-- With p_style_to_all, the other clips of the project get the same style.
-- Returns how many clips were queued.
create function public.edit_clip(p_clip uuid, p_edit jsonb, p_style_to_all boolean default false)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  c public.clips;
  p public.projects;
  v_words jsonb := p_edit -> 'words';
  v_style jsonb := p_edit -> 'style';
  v_start real;
  v_end real;
  v_lo real;
  v_hi real;
  v_others integer := 0;
begin
  select * into c from public.clips where id = p_clip for update;
  if not found then
    raise exception 'not_found';
  end if;
  select * into p from public.projects where id = c.project_id;
  if v_user is null or p.user_id is distinct from v_user then
    raise exception 'not_found';
  end if;
  if p.status <> 'ready' or p.expires_at <= now() then
    raise exception 'not_ready';
  end if;

  if jsonb_typeof(p_edit) is distinct from 'object' or p_edit = '{}'::jsonb
     or pg_column_size(p_edit) > 262144
     or exists (select 1 from jsonb_object_keys(p_edit) k
                 where k not in ('words', 'hook', 'start', 'end', 'style'))
     or (p_style_to_all and v_style is null) then
    raise exception 'bad_edit';
  end if;
  if v_words is not null and (
       jsonb_typeof(v_words) <> 'array' or jsonb_array_length(v_words) > 3000
       or exists (select 1 from jsonb_array_elements(v_words) w
                   where jsonb_typeof(w -> 'text') is distinct from 'string'
                      or jsonb_typeof(w -> 'start') is distinct from 'number'
                      or jsonb_typeof(w -> 'end') is distinct from 'number'
                      or length(w ->> 'text') not between 1 and 80)) then
    raise exception 'bad_edit';
  end if;
  if p_edit ? 'hook' and (jsonb_typeof(p_edit -> 'hook') <> 'string'
                          or length(p_edit ->> 'hook') > 120) then
    raise exception 'bad_edit';
  end if;

  if p_edit ?| array['start', 'end', 'style'] and not private.is_priority(v_user) then
    raise exception 'buyers_only';
  end if;
  if v_style is not null and (
       jsonb_typeof(v_style) <> 'object'
       or exists (select 1 from jsonb_object_keys(v_style) k
                   where k not in ('template', 'position', 'wordsPerCaption', 'layout', 'hookTitle', 'coldOpen'))
       or (v_style ? 'template' and coalesce(v_style ->> 'template', '') not in ('karaoke', 'box', 'ali'))
       or (v_style ? 'position' and coalesce(v_style ->> 'position', '') not in ('top', 'middle', 'bottom'))
       or (v_style ? 'wordsPerCaption' and coalesce(v_style ->> 'wordsPerCaption', '') !~ '^[1-6]$')
       or (v_style ? 'layout' and coalesce(v_style ->> 'layout', '') not in ('auto', 'fill', 'fit', 'square'))
       or (v_style ? 'hookTitle' and jsonb_typeof(v_style -> 'hookTitle') <> 'boolean')
       or (v_style ? 'coldOpen' and jsonb_typeof(v_style -> 'coldOpen') <> 'boolean')) then
    raise exception 'bad_edit';
  end if;

  if p_edit ?| array['start', 'end'] then
    if (p_edit ? 'start' and jsonb_typeof(p_edit -> 'start') <> 'number')
       or (p_edit ? 'end' and jsonb_typeof(p_edit -> 'end') <> 'number') then
      raise exception 'bad_edit';
    end if;
    v_start := coalesce((p_edit ->> 'start')::real, c.start_seconds);
    v_end := coalesce((p_edit ->> 'end')::real, c.end_seconds);
    v_lo := greatest(coalesce(c.original_start, c.start_seconds) - 30, 0);
    v_hi := coalesce(c.original_end, c.end_seconds) + 30;
    if p.duration_seconds is not null then
      v_hi := least(v_hi, p.duration_seconds);
    end if;
    if v_start < v_lo - 0.01 or v_end > v_hi + 0.01
       or v_end - v_start < 3 or v_end - v_start > 180 then
      raise exception 'bad_trim';
    end if;
    update public.clips
       set original_start = coalesce(original_start, start_seconds),
           original_end = coalesce(original_end, end_seconds)
     where id = c.id;
  end if;

  if exists (select 1 from public.jobs where clip_id = c.id and status in ('queued', 'running')) then
    raise exception 'edit_in_progress';
  end if;
  if (select count(*) from public.jobs j join public.projects o on o.id = j.project_id
       where o.user_id = v_user and j.kind = 'rerender_clip' and j.status in ('queued', 'running')) >= 20 then
    raise exception 'too_many_edits';
  end if;

  insert into public.jobs (project_id, kind, clip_id, payload)
  values (c.project_id, 'rerender_clip', c.id, p_edit);

  if p_style_to_all then
    insert into public.jobs (project_id, kind, clip_id, payload)
    select o.project_id, 'rerender_clip', o.id, jsonb_build_object('style', v_style)
      from public.clips o
     where o.project_id = c.project_id and o.id <> c.id
       and not exists (select 1 from public.jobs a where a.clip_id = o.id and a.status in ('queued', 'running'));
    get diagnostics v_others = row_count;
  end if;
  return 1 + v_others;
end;
$$;

revoke execute on function public.edit_clip(uuid, jsonb, boolean) from public, anon;
grant execute on function public.edit_clip(uuid, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- user_terms: a buyer's name dictionary
-- ---------------------------------------------------------------------------
create table public.user_terms (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  wrong text not null check (length(wrong) between 1 and 60),
  correct text not null check (length(correct) between 1 and 60),
  created_at timestamptz not null default now()
);

create unique index user_terms_wrong_idx on public.user_terms (user_id, lower(wrong));

alter table public.user_terms enable row level security;

create policy "own terms: read" on public.user_terms
  for select to authenticated using (user_id = auth.uid());

-- Written only through the functions below.
revoke all on public.user_terms from anon;
revoke insert, update, delete, truncate, references, trigger on public.user_terms from authenticated;

-- Adds a term, or changes how an existing one is written. Returns its id.
create function public.save_term(p_wrong text, p_correct text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_wrong text := btrim(regexp_replace(coalesce(p_wrong, ''), '\s+', ' ', 'g'));
  v_correct text := btrim(regexp_replace(coalesce(p_correct, ''), '\s+', ' ', 'g'));
  v_id bigint;
begin
  if v_user is null then
    raise exception 'not_found';
  end if;
  if not private.is_priority(v_user) then
    raise exception 'buyers_only';
  end if;
  if length(v_wrong) not between 1 and 60 or length(v_correct) not between 1 and 60
     or v_wrong = v_correct then
    raise exception 'bad_term';
  end if;
  if (select count(*) from public.user_terms where user_id = v_user) >= 200
     and not exists (select 1 from public.user_terms where user_id = v_user and lower(wrong) = lower(v_wrong)) then
    raise exception 'too_many_terms';
  end if;
  insert into public.user_terms (user_id, wrong, correct)
  values (v_user, v_wrong, v_correct)
  on conflict (user_id, lower(wrong)) do update set correct = excluded.correct
  returning id into v_id;
  return v_id;
end;
$$;

create function public.delete_term(p_id bigint)
returns void
language sql security definer set search_path = public as $$
  delete from public.user_terms where id = p_id and user_id = auth.uid();
$$;

revoke execute on function public.save_term(text, text) from public, anon;
revoke execute on function public.delete_term(bigint) from public, anon;
grant execute on function public.save_term(text, text) to authenticated;
grant execute on function public.delete_term(bigint) to authenticated;
