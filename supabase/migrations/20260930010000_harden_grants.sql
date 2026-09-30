-- Tighten what the public API roles can do, ahead of the public launch.
--
-- Supabase grants anon and authenticated every table privilege by default and
-- leaves RLS as the only gate. RLS already blocks what matters, but a few
-- columns were writable through PostgREST that the app never writes:
--
--   projects.expires_at   a user could keep their clips forever
--   projects.status/error only 'queued' passes the insert policy, but still
--   projects.thumbnail_url any URL, loaded as an <img> on the projects pages
--
-- The web app inserts projects with exactly the columns granted below; the
-- worker connects as the database owner and is not affected.

-- ---------------------------------------------------------------------------
-- projects: insert only the columns the Create form sets, never update
-- ---------------------------------------------------------------------------
revoke insert, update on public.projects from anon, authenticated;
grant insert (user_id, youtube_url, youtube_id, title, thumbnail_url, duration_seconds, video_language, options)
  on public.projects to authenticated;

-- The thumbnail always comes from YouTube's image host for the video's id.
create function public.normalize_new_project() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.youtube_id := case when new.youtube_id ~ '^[A-Za-z0-9_-]{11}$' then new.youtube_id end;
  new.thumbnail_url := case when new.youtube_id is not null
    then 'https://i.ytimg.com/vi/' || new.youtube_id || '/hqdefault.jpg' end;
  new.title := left(new.title, 300);
  return new;
end;
$$;

revoke execute on function public.normalize_new_project() from public, anon, authenticated;

create trigger normalize_before_insert
  before insert on public.projects
  for each row execute function public.normalize_new_project();

-- ---------------------------------------------------------------------------
-- signed-out visitors only read the price list and the caption templates
-- ---------------------------------------------------------------------------
revoke all on public.profiles, public.projects, public.jobs, public.clips, public.credit_ledger,
  public.credit_orders, public.clip_posts, public.youtube_connections
  from anon;
revoke insert, update, delete on public.credit_packs, public.caption_templates from anon, authenticated;

-- Nobody reaches these through the API; TRUNCATE in particular ignores RLS.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- Server-only tables: no API writes at all (the functions that write them are
-- security definer, and the worker is the table owner).
revoke insert, update, delete on public.jobs, public.clips, public.credit_ledger, public.credit_orders,
  public.profiles
  from authenticated;
grant update (display_name, ui_language) on public.profiles to authenticated;
