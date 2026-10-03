-- "Kabari saya saat klip siap": email the owner once a project is done.
--
-- profiles.notify_email  the switch on the queue card, on by default
-- projects.notified_at   set when the worker sends (or skips) the email, so a
--                        project is never mailed twice
--
-- The worker sends the email; take_project_notification() decides whether to.

alter table public.profiles add column notify_email boolean not null default true;
grant update (notify_email) on public.profiles to authenticated;

alter table public.projects add column notified_at timestamptz;

-- Marks a finished project (ready or failed) as notified and, when the owner
-- wants emails, returns what the email needs. Returns no row when the project
-- is still running, was already notified, or the owner turned emails off.
create function public.take_project_notification(p_project_id uuid)
returns table (
  email text,
  ui_language text,
  title text,
  status project_status,
  user_id uuid,
  clip_count integer
)
language plpgsql security definer set search_path = public as $$
declare
  proj public.projects;
begin
  update public.projects p
     set notified_at = now()
   where p.id = p_project_id
     and p.notified_at is null
     and p.status in ('ready', 'failed')
  returning p.* into proj;
  if not found then
    return;
  end if;

  return query
  select u.email::text, pr.ui_language, proj.title, proj.status, proj.user_id,
         (select count(*)::integer from public.clips c where c.project_id = proj.id)
    from auth.users u
    join public.profiles pr on pr.id = u.id
   where u.id = proj.user_id
     and pr.notify_email
     and u.email is not null;
end;
$$;

revoke execute on function public.take_project_notification(uuid) from public, anon, authenticated;
