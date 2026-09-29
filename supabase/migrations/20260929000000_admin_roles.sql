-- Staff roles: the owner adds and removes admins from /admin instead of the
-- SQL editor.
--
--   owner  everything an admin can do, plus managing admins
--   admin  find users, see their history, adjust credits
--   user   everyone else
--
-- profiles.role replaces profiles.is_admin; whoever was an admin becomes an
-- owner. Nobody can grant the owner role from the app, the owner cannot change
-- their own role, and users still cannot write the column (they only hold
-- UPDATE on display_name and ui_language).

alter table public.profiles
  add column role text not null default 'user' check (role in ('user', 'admin', 'owner'));
update public.profiles set role = 'owner' where is_admin;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select p.role in ('admin', 'owner') from public.profiles p where p.id = auth.uid()), false);
$$;

alter table public.profiles drop column is_admin;

create function public.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.role = 'owner' from public.profiles p where p.id = auth.uid()), false);
$$;

-- Owners and admins, owners first.
create function public.admin_list_staff()
returns table (id uuid, email text, display_name text, role text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  return query
  select u.id, u.email::text, p.display_name, p.role, p.created_at
    from public.profiles p join auth.users u on u.id = p.id
   where p.role in ('admin', 'owner')
   order by p.role = 'owner' desc, p.created_at;
end;
$$;

-- Makes a signed-up user an admin, or back to a regular user. Owners only.
create function public.admin_set_role(target_email text, new_role text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  target uuid;
  target_role text;
begin
  if not public.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if new_role not in ('user', 'admin') then
    raise exception 'bad_role' using errcode = '22023';
  end if;
  select u.id, p.role into target, target_role
    from auth.users u join public.profiles p on p.id = u.id
   where lower(u.email) = lower(trim(target_email));
  if target is null then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  if target = auth.uid() or target_role = 'owner' then
    raise exception 'owner_locked' using errcode = '42501';
  end if;
  update public.profiles set role = new_role where id = target;
  return new_role;
end;
$$;

-- Newest sign-ups with their balance and project count, for the /admin list.
create function public.admin_recent_users(max_rows integer default 20)
returns table (
  id uuid, email text, display_name text, plan public.plan_tier, credits_remaining integer,
  role text, created_at timestamptz, projects bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  return query
  select u.id, u.email::text, p.display_name, p.plan, p.credits_remaining, p.role, p.created_at,
         (select count(*) from public.projects j where j.user_id = p.id)
    from public.profiles p join auth.users u on u.id = p.id
   order by p.created_at desc
   limit least(greatest(coalesce(max_rows, 20), 1), 100);
end;
$$;

revoke execute on function public.is_owner() from public, anon;
revoke execute on function public.admin_list_staff() from public, anon;
revoke execute on function public.admin_set_role(text, text) from public, anon;
revoke execute on function public.admin_recent_users(integer) from public, anon;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.admin_list_staff() to authenticated;
grant execute on function public.admin_set_role(text, text) to authenticated;
grant execute on function public.admin_recent_users(integer) to authenticated;
