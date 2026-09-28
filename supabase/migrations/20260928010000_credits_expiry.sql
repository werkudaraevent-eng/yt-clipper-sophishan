-- Credits and project expiry (M4).
--
-- Credits: 1 credit per started minute of the processing timeframe, charged
-- when the project is created and refunded if processing finally fails. The
-- ledger is the record; profiles.credits_remaining is its cached sum, and the
-- check constraint on it is what stops a user from going negative.
--
-- Expiry: projects are kept 60 days. expire_projects() marks overdue projects
-- expired, drops their clip rows and returns the storage paths the worker must
-- delete from the `clips` bucket.

alter table public.projects add column credits_charged integer not null default 0;

-- Credits a project costs: started minutes of its timeframe, clipped to the
-- video length when known, at least 1.
create function public.project_credit_cost(options jsonb, duration_seconds integer)
returns integer
language sql immutable as $$
  select greatest(1, ceil(
    greatest(0,
      least((options -> 'timeframe' ->> 'end')::numeric,
            coalesce(duration_seconds::numeric, (options -> 'timeframe' ->> 'end')::numeric))
      - (options -> 'timeframe' ->> 'start')::numeric
    ) / 60
  ))::integer;
$$;

create function public.charge_project_credits() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cost integer := public.project_credit_cost(new.options, new.duration_seconds);
begin
  update public.profiles
     set credits_remaining = credits_remaining - cost
   where id = new.user_id and credits_remaining >= cost;
  if not found then
    raise exception 'insufficient_credits' using errcode = 'P0001',
      hint = format('This project needs %s credits.', cost);
  end if;
  new.credits_charged := cost;
  return new;
end;
$$;

create trigger charge_credits_before_insert
  before insert on public.projects
  for each row execute function public.charge_project_credits();

-- The ledger row needs the project id, which exists only after the insert.
create function public.record_project_charge() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.credit_ledger (user_id, delta, reason, project_id)
  values (new.user_id, -new.credits_charged, 'project', new.id);
  return new;
end;
$$;

create trigger record_charge_after_insert
  after insert on public.projects
  for each row execute function public.record_project_charge();

-- Refund once when a project ends up failed (after all retries).
create function public.refund_failed_project() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'failed' and old.status is distinct from 'failed' and new.credits_charged > 0 then
    update public.profiles set credits_remaining = credits_remaining + new.credits_charged
     where id = new.user_id;
    insert into public.credit_ledger (user_id, delta, reason, project_id)
    values (new.user_id, new.credits_charged, 'refund_failed', new.id);
  end if;
  return new;
end;
$$;

create trigger refund_on_failure
  after update of status on public.projects
  for each row execute function public.refund_failed_project();

-- Record the sign-up grant too, so the ledger sums to the balance.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p public.profiles;
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  returning * into p;
  insert into public.credit_ledger (user_id, delta, reason)
  values (new.id, p.credits_remaining, 'signup_grant');
  return new;
end;
$$;

-- Users could otherwise top themselves up through the "own profile: update"
-- policy. Only display name and UI language are theirs to change.
revoke update on public.profiles from authenticated;
grant update (display_name, ui_language) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- expiry
-- ---------------------------------------------------------------------------
create index projects_expiry_idx on public.projects (expires_at) where status <> 'expired';

create function public.expire_projects(batch integer default 100)
returns table (project_id uuid, path text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with overdue as (
    select p.id from public.projects p
     where p.expires_at <= now() and p.status <> 'expired'
       -- never pull the rug from under a running job
       and not exists (select 1 from public.jobs j where j.project_id = p.id and j.status = 'running')
     order by p.expires_at
     limit batch
     for update skip locked
  ),
  marked as (
    update public.projects p set status = 'expired', updated_at = now()
      from overdue o where p.id = o.id
    returning p.id
  ),
  cancelled as (
    update public.jobs j set status = 'failed', error = 'project expired', finished_at = now()
      from marked m where j.project_id = m.id and j.status = 'queued'
    returning j.id
  ),
  removed as (
    delete from public.clips c using marked m where c.project_id = m.id
    returning c.project_id, c.video_path, c.thumbnail_path
  )
  select r.project_id, x.path
    from removed r
    cross join lateral (values (r.video_path), (r.thumbnail_path)) as x(path)
   where x.path is not null;
end;
$$;

revoke execute on function public.expire_projects(integer) from public, anon, authenticated;
