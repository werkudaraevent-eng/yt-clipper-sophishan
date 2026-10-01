-- Scheduled posting: a clip goes up to YouTube at a time the user picks.
--
-- A scheduled post is a clip_posts row with status 'scheduled' and a
-- scheduled_at time. A Vercel cron job claims due rows one at a time through
-- claim_due_clip_post(), uploads them with the owner's stored YouTube token,
-- and reports back through finish_clip_post(). The cron has no user session,
-- so those functions take a shared token, like settle_credit_order: its
-- SHA-256 lives in private.settings (key scheduler_token_sha256) and the plain
-- value in the web app's CRON_SECRET env var. Neither is in this repository.
--
-- The cron reads the clip file through a signed storage link that the web app
-- creates, with the user's own session, when the clip is scheduled. Only the
-- link's token is stored (file_token); the cron rebuilds the URL from the
-- clip's own storage path, so whatever a user stores there, the cron only
-- ever fetches that clip from our storage.
--
-- views_24h holds a Short's view count a day after it went up. The scheduler
-- learns the channel's busy hours from it.

-- ---------------------------------------------------------------------------
-- clip_posts: scheduling columns
-- ---------------------------------------------------------------------------
alter table public.clip_posts drop constraint clip_posts_status_check;
alter table public.clip_posts add constraint clip_posts_status_check
  check (status in ('scheduled', 'uploading', 'published', 'failed', 'canceled'));

alter table public.clip_posts
  add column scheduled_at timestamptz,
  add column title text check (char_length(title) <= 100),
  add column description text check (char_length(description) <= 5000),
  add column file_token text,
  add column error_code text,
  add column attempts smallint not null default 0,
  add column published_at timestamptz,
  add column views_24h integer check (views_24h >= 0),
  add column stats_checked_at timestamptz;

update public.clip_posts set published_at = updated_at where status = 'published';

create index clip_posts_due_idx on public.clip_posts (scheduled_at) where status = 'scheduled';
create index clip_posts_user_idx on public.clip_posts (user_id, created_at desc);
create index clip_posts_stats_idx on public.clip_posts (published_at)
  where status = 'published' and views_24h is null;
-- A clip waits in the queue at most once.
create unique index clip_posts_one_scheduled on public.clip_posts (clip_id) where status = 'scheduled';

-- The owner can change what the upload route changes when posting with their
-- session; scheduling itself goes through the functions below.
revoke update on public.clip_posts from authenticated;
grant update (status, external_id, error, error_code, title, description, privacy, published_at, updated_at)
  on public.clip_posts to authenticated;

-- Rows only enter the queue through schedule_clip_post (which checks the
-- project, the time window and the stored file link): the owner can neither
-- insert queue fields nor flip a row back into the queue.
revoke insert on public.clip_posts from authenticated;
grant insert (clip_id, user_id, privacy, title, description) on public.clip_posts to authenticated;
drop policy "clip_posts: owner updates" on public.clip_posts;
create policy "clip_posts: owner updates"
  on public.clip_posts for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and status in ('uploading', 'published', 'failed'));

-- ---------------------------------------------------------------------------
-- profiles: how the bulk scheduler spreads clips
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column post_per_day smallint not null default 1 check (post_per_day in (1, 2)),
  add column post_peak_only boolean not null default true;

grant update (post_per_day, post_peak_only) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- user functions
-- ---------------------------------------------------------------------------

-- Queues one of the caller's clips, or moves it if it is already queued (or
-- failed in the queue). Returns the post id.
create function public.schedule_clip_post(
  p_clip uuid, p_at timestamptz, p_privacy text, p_title text, p_description text, p_file_token text
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_expires timestamptz;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  -- Locks the clip, so two requests can't both queue it.
  select p.expires_at into v_expires
    from public.clips c join public.projects p on p.id = c.project_id
   where c.id = p_clip and p.user_id = v_user and p.status = 'ready'
     for update of c;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.youtube_connections y where y.user_id = v_user) then
    raise exception 'reconnect' using errcode = 'P0001';
  end if;
  if p_privacy is null or p_privacy not in ('private', 'unlisted', 'public')
     or coalesce(p_file_token, '') = '' then
    raise exception 'bad_request' using errcode = '22023';
  end if;
  -- Not in the past, within 30 days, and before the clip is deleted.
  if p_at is null or p_at < now() - interval '5 minutes' or p_at > now() + interval '30 days'
     or p_at > v_expires - interval '1 hour' then
    raise exception 'bad_time' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.clip_posts q where q.clip_id = p_clip and q.status in ('uploading', 'published')
  ) then
    raise exception 'already_posted' using errcode = 'P0001';
  end if;

  select q.id into v_id
    from public.clip_posts q
   where q.clip_id = p_clip and q.scheduled_at is not null and q.status in ('scheduled', 'failed')
   order by q.status = 'scheduled' desc, q.created_at desc
   limit 1;

  if v_id is null then
    insert into public.clip_posts (clip_id, user_id, status, privacy, scheduled_at, title, description, file_token)
    values (p_clip, v_user, 'scheduled', p_privacy, p_at, left(p_title, 100), left(p_description, 5000), p_file_token)
    returning id into v_id;
  else
    update public.clip_posts
       set status = 'scheduled', privacy = p_privacy, scheduled_at = p_at, title = left(p_title, 100),
           description = left(p_description, 5000), file_token = p_file_token, error = null,
           error_code = null, attempts = 0, updated_at = now()
     where id = v_id;
  end if;

  -- Older failed attempts for this clip are settled by this one.
  update public.clip_posts
     set status = 'canceled', updated_at = now()
   where clip_id = p_clip and status = 'failed' and scheduled_at is not null and id <> v_id;
  return v_id;
end;
$$;

-- Takes a queued (or failed) post off the schedule.
create function public.cancel_clip_post(p_post uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.clip_posts
     set status = 'canceled', updated_at = now()
   where id = p_post and user_id = auth.uid() and status in ('scheduled', 'failed');
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.schedule_clip_post(uuid, timestamptz, text, text, text, text) from public, anon;
revoke execute on function public.cancel_clip_post(uuid) from public, anon;
grant execute on function public.schedule_clip_post(uuid, timestamptz, text, text, text, text) to authenticated;
grant execute on function public.cancel_clip_post(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- cron functions (token-guarded; the cron calls them with the anon key)
-- ---------------------------------------------------------------------------
create function private.check_scheduler_token(p_token text)
returns void
language plpgsql stable set search_path = '' as $$
declare
  expected text;
begin
  select s.value into expected from private.settings s where s.key = 'scheduler_token_sha256';
  if expected is null or p_token is null
     or encode(extensions.digest(p_token, 'sha256'), 'hex') <> expected then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function private.check_scheduler_token(text) from public, anon, authenticated;

-- Claims the next due post (or none) and marks it uploading. Also settles
-- what an earlier run left behind: an upload that never reported back is
-- failed rather than retried, because it may have reached YouTube.
create function public.claim_due_clip_post(p_token text)
returns table (
  post_id uuid,
  post_user_id uuid,
  video_path text,
  title text,
  description text,
  privacy text,
  file_token text,
  attempts smallint,
  refresh_token_enc text
)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform private.check_scheduler_token(p_token);

  update public.clip_posts
     set status = 'failed', error_code = 'timeout', error = 'upload did not finish', updated_at = now()
   where status = 'uploading' and updated_at < now() - interval '15 minutes';

  update public.clip_posts s
     set status = 'canceled', error_code = 'duplicate', updated_at = now()
   where s.status = 'scheduled' and s.scheduled_at <= now()
     and exists (select 1 from public.clip_posts q where q.clip_id = s.clip_id and q.status = 'published');

  return query
  with due as (
    select p.id
      from public.clip_posts p
     where p.status = 'scheduled' and p.scheduled_at <= now()
       and not exists (
         select 1 from public.clip_posts q where q.clip_id = p.clip_id and q.status = 'uploading'
       )
     order by p.scheduled_at
     limit 1
       for update of p skip locked
  ), claimed as (
    update public.clip_posts p
       set status = 'uploading', attempts = p.attempts + 1, updated_at = now()
      from due
     where p.id = due.id
    returning p.id, p.user_id, p.clip_id, p.title, p.description, p.privacy, p.file_token, p.attempts
  )
  select c.id, c.user_id, cl.video_path, c.title, c.description, c.privacy, c.file_token, c.attempts,
         y.refresh_token_enc
    from claimed c
    join public.clips cl on cl.id = c.clip_id
    left join public.youtube_connections y on y.user_id = c.user_id;
end;
$$;

-- Records how an upload went. p_status is 'published', 'failed', or 'retry'
-- (back in the queue for another try in ten minutes).
create function public.finish_clip_post(
  p_token text, p_post uuid, p_status text, p_external_id text, p_error_code text, p_error text,
  p_channel_title text
)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  perform private.check_scheduler_token(p_token);

  if p_status = 'published' then
    update public.clip_posts
       set status = 'published', external_id = p_external_id, published_at = now(), error = null,
           error_code = null, updated_at = now()
     where id = p_post and status = 'uploading'
    returning user_id into v_user;
    if v_user is not null and p_channel_title is not null then
      update public.youtube_connections
         set channel_title = left(p_channel_title, 200), updated_at = now()
       where user_id = v_user;
    end if;
  elsif p_status = 'retry' then
    update public.clip_posts
       set status = 'scheduled', scheduled_at = now() + interval '10 minutes', error_code = p_error_code,
           error = left(p_error, 500), updated_at = now()
     where id = p_post and status = 'uploading';
  elsif p_status = 'failed' then
    update public.clip_posts
       set status = 'failed', error_code = p_error_code, error = left(p_error, 500), updated_at = now()
     where id = p_post and status = 'uploading'
    returning user_id into v_user;
    -- Google no longer accepts the token: drop it so the app asks to reconnect.
    if v_user is not null and p_error_code = 'reconnect' then
      delete from public.youtube_connections where user_id = v_user;
    end if;
  else
    raise exception 'bad_request' using errcode = '22023';
  end if;
end;
$$;

-- Shorts that went up 24 to 72 hours ago and have no view count yet. Each is
-- handed out at most once an hour.
create function public.due_clip_post_stats(p_token text, p_limit integer)
returns table (post_id uuid, external_id text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform private.check_scheduler_token(p_token);
  return query
  update public.clip_posts p
     set stats_checked_at = now()
   where p.id in (
     select q.id
       from public.clip_posts q
      where q.status = 'published' and q.views_24h is null and q.external_id is not null
        and q.published_at between now() - interval '72 hours' and now() - interval '24 hours'
        and (q.stats_checked_at is null or q.stats_checked_at < now() - interval '1 hour')
      order by q.published_at
      limit least(greatest(p_limit, 1), 50)
   )
  returning p.id, p.external_id;
end;
$$;

create function public.save_clip_post_views(p_token text, p_posts uuid[], p_views integer[])
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_scheduler_token(p_token);
  update public.clip_posts p
     set views_24h = v.views
    from unnest(p_posts, p_views) as v(id, views)
   where p.id = v.id and p.status = 'published' and v.views >= 0;
end;
$$;

revoke execute on function public.claim_due_clip_post(text) from public;
revoke execute on function public.finish_clip_post(text, uuid, text, text, text, text, text) from public;
revoke execute on function public.due_clip_post_stats(text, integer) from public;
revoke execute on function public.save_clip_post_views(text, uuid[], integer[]) from public;
grant execute on function public.claim_due_clip_post(text) to anon, authenticated;
grant execute on function public.finish_clip_post(text, uuid, text, text, text, text, text) to anon, authenticated;
grant execute on function public.due_clip_post_stats(text, integer) to anon, authenticated;
grant execute on function public.save_clip_post_views(text, uuid[], integer[]) to anon, authenticated;
