-- Admins: look up a user by email and adjust their credits from /admin.
--
-- profiles.is_admin is set by hand (SQL editor or migration); users cannot
-- change it because they only hold UPDATE on display_name and ui_language.
-- Both functions are security definer and refuse callers who are not admins.

alter table public.profiles add column is_admin boolean not null default false;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;

create function public.admin_find_user(target_email text)
returns table (id uuid, email text, display_name text, plan public.plan_tier, credits_remaining integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  return query
  select u.id, u.email::text, p.display_name, p.plan, p.credits_remaining
    from auth.users u join public.profiles p on p.id = u.id
   where lower(u.email) = lower(trim(target_email));
end;
$$;

-- Adds `delta` credits (negative to deduct) and records it in the ledger.
-- Returns the new balance; the balance check constraint rejects going below 0.
create function public.admin_adjust_credits(target_user uuid, delta integer, note text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  balance integer;
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  if delta = 0 then
    raise exception 'zero_delta' using errcode = '22023';
  end if;
  update public.profiles set credits_remaining = credits_remaining + delta
   where id = target_user
  returning credits_remaining into balance;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  insert into public.credit_ledger (user_id, delta, reason)
  values (target_user, delta, 'admin: ' || coalesce(nullif(trim(note), ''), 'adjustment')
                              || ' (by ' || auth.uid()::text || ')');
  return balance;
end;
$$;

revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.admin_find_user(text) from public, anon;
revoke execute on function public.admin_adjust_credits(uuid, integer, text) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_find_user(text) to authenticated;
grant execute on function public.admin_adjust_credits(uuid, integer, text) to authenticated;
