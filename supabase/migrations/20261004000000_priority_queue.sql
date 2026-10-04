-- Priority lane for credit buyers.
--
-- Anyone who has ever paid for a credit pack waits in the priority lane. The
-- free lane is not starved: every 3rd job a worker claims comes from it (when
-- the last two claims were both priority, the next one prefers a free job).
-- An empty lane never holds a worker back; the other lane is used instead.

-- The lane the current attempt was claimed from.
alter table public.jobs add column priority boolean not null default false;

create function private.is_priority(p_user_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.credit_orders o where o.user_id = p_user_id and o.status = 'paid'
  );
$$;

revoke execute on function private.is_priority(uuid) from public, anon, authenticated;

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
       order by (lane.priority <> free_turn) desc, c.run_after
       limit 1
       for update of c skip locked
    ) pick
   where j.id = pick.id
  returning j.*;
end;
$$;

revoke execute on function public.claim_job(text, interval) from public, anon, authenticated;

-- Same as before, plus `priority` (the caller's lane). `place` now counts the
-- jobs that will be claimed before this one: in the priority lane, the priority
-- jobs ahead plus one free job for every two of them; in the free lane, the
-- free jobs ahead plus up to two priority jobs before each of them.
drop function public.queue_position(uuid);

create function public.queue_position(p_project_id uuid)
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
   where j.project_id = p_project_id and p.user_id = auth.uid()
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
   where status = 'succeeded' and started_at is not null
     and finished_at > now() - interval '24 hours';

  place := n_ahead + 1;
  workers := n_workers;
  avg_seconds := round(avg_s);
  eta_seconds := round(avg_s * (0.5 + floor(n_ahead::numeric / n_workers)));
  priority := mine_priority;
  return next;
end;
$$;

revoke execute on function public.queue_position(uuid) from public, anon;
grant execute on function public.queue_position(uuid) to authenticated;
