-- Queue position for the project page: where a waiting project stands in line
-- and roughly when a worker will pick it up.

-- When the current attempt started, so the estimate can use real job durations
-- (finished_at - created_at would include the time spent waiting in line).
alter table public.jobs add column started_at timestamptz;

create or replace function public.claim_job(worker_id text, stale_after interval default interval '30 minutes')
returns setof public.jobs
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.jobs j
     set status = 'running',
         attempt = j.attempt + 1,
         locked_by = worker_id,
         locked_at = now(),
         started_at = now(),
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

revoke execute on function public.claim_job(text, interval) from public, anon, authenticated;

-- For one of the caller's own queued projects:
--   place        1 = next to be claimed (jobs are claimed in run_after order)
--   workers      jobs running right now, at least 1: while there is a line,
--                every worker is busy, so this is how many work in parallel
--   avg_seconds  mean duration of jobs that succeeded in the last 24 hours,
--                10 minutes until there is data
--   eta_seconds  when this project should start
-- Returns no row when the project is not the caller's or is not queued.
create function public.queue_position(p_project_id uuid)
returns table (place integer, workers integer, avg_seconds integer, eta_seconds integer)
language plpgsql stable security definer set search_path = public as $$
declare
  mine public.jobs;
  n_ahead integer;
  n_workers integer;
  avg_s double precision;
begin
  select j.* into mine
    from public.jobs j join public.projects p on p.id = j.project_id
   where j.project_id = p_project_id and p.user_id = auth.uid()
     and j.status = 'queued' and j.attempt < j.max_attempts
   order by j.created_at desc
   limit 1;
  if not found then
    return;
  end if;

  select count(*) into n_ahead
    from public.jobs
   where status = 'queued' and attempt < max_attempts
     and (run_after, id) < (mine.run_after, mine.id);

  select greatest(count(*), 1) into n_workers
    from public.jobs
   where status = 'running' and locked_at > now() - interval '30 minutes';

  select coalesce(extract(epoch from avg(finished_at - started_at)), 600) into avg_s
    from public.jobs
   where status = 'succeeded' and started_at is not null
     and finished_at > now() - interval '24 hours';

  -- The running jobs are about half done on average; each later round of
  -- `n_workers` jobs takes one average duration.
  place := n_ahead + 1;
  workers := n_workers;
  avg_seconds := round(avg_s);
  eta_seconds := round(avg_s * (0.5 + floor(n_ahead::numeric / n_workers)));
  return next;
end;
$$;

revoke execute on function public.queue_position(uuid) from public, anon;
grant execute on function public.queue_position(uuid) to authenticated;
