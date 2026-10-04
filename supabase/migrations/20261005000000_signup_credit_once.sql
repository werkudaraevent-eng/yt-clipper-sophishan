-- Free sign-up credits once per real inbox.
--
-- Gmail delivers nama+1@gmail.com and n.a.m.a@gmail.com to nama@gmail.com, so
-- one inbox could open any number of accounts, each with free credits. The
-- sign-up grant now goes only to the first account of each normalized address
-- (lowercase, "+tag" dropped, dots dropped for Gmail), and never to an address
-- at a throwaway-mail domain. Other accounts still work and can buy credits;
-- they start at 0. The same rule gates the referral friend bonus.
--
-- The list of addresses outlives deleted accounts, so deleting and signing up
-- again does not grant twice.

-- ---------------------------------------------------------------------------
-- normalizing an address
-- ---------------------------------------------------------------------------
create function private.normalize_email(p_email text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  e text := lower(trim(coalesce(p_email, '')));
  local text;
  domain text;
begin
  if position('@' in e) = 0 then
    return nullif(e, '');
  end if;
  local := split_part(e, '@', 1);
  domain := split_part(e, '@', 2);
  local := split_part(local, '+', 1);
  if domain in ('gmail.com', 'googlemail.com') then
    local := replace(local, '.', '');
    domain := 'gmail.com';
  end if;
  return local || '@' || domain;
end;
$$;

revoke execute on function private.normalize_email(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- addresses that already got their free credits
-- ---------------------------------------------------------------------------
create table private.signup_grants (
  email text primary key,
  user_id uuid,
  created_at timestamptz not null default now()
);

-- Accounts made before this migration count as granted.
insert into private.signup_grants (email, user_id, created_at)
select private.normalize_email(u.email), u.id, p.created_at
  from auth.users u
  join public.profiles p on p.id = u.id
 where u.email is not null
 order by p.created_at
on conflict (email) do nothing;

-- ---------------------------------------------------------------------------
-- throwaway-mail domains (add more with an insert)
-- ---------------------------------------------------------------------------
create table private.disposable_email_domains (
  domain text primary key
);

insert into private.disposable_email_domains (domain) values
  ('mailinator.com'), ('guerrillamail.com'), ('guerrillamail.net'),
  ('guerrillamail.org'), ('guerrillamailblock.com'), ('sharklasers.com'),
  ('grr.la'), ('10minutemail.com'), ('10minutemail.net'), ('temp-mail.org'),
  ('temp-mail.io'), ('tempmail.com'), ('tempmail.net'), ('tempmailo.com'),
  ('tempr.email'), ('throwawaymail.com'), ('yopmail.com'), ('yopmail.net'),
  ('yopmail.fr'), ('getnada.com'), ('nada.email'), ('dispostable.com'),
  ('maildrop.cc'), ('mailnesia.com'), ('mintemail.com'), ('mohmal.com'),
  ('trashmail.com'), ('trashmail.net'), ('fakeinbox.com'), ('emailondeck.com'),
  ('mailcatch.com'), ('moakt.com'), ('spamgourmet.com'), ('mytemp.email'),
  ('tmpmail.org'), ('tmpmail.net'), ('tmail.ws'), ('1secmail.com'),
  ('1secmail.org'), ('1secmail.net'), ('mail.tm'), ('mail.gw'),
  ('emailfake.com'), ('generator.email'), ('inboxkitten.com'),
  ('burnermail.io'), ('spambox.us'), ('mailpoof.com'), ('linshiyouxiang.net'),
  ('dropmail.me'), ('minuteinbox.com'), ('tempinbox.com'), ('anonaddy.me'),
  ('cs.email'), ('byom.de'), ('harakirimail.com'), ('mailsac.com'),
  ('mvrht.net'), ('trbvm.com'), ('vomoto.com'), ('zetmail.com')
on conflict (domain) do nothing;

-- Records the address and says whether this account gets free credits.
create function private.claim_signup_grant(p_user uuid, p_email text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  e text := private.normalize_email(p_email);
begin
  if e is null then
    return true;
  end if;
  if exists (select 1 from private.disposable_email_domains d
              where d.domain = split_part(e, '@', 2)) then
    return false;
  end if;
  insert into private.signup_grants (email, user_id) values (e, p_user)
  on conflict (email) do nothing;
  return found;
end;
$$;

revoke execute on function private.claim_signup_grant(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- sign-up grant: only the first account of each inbox
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p public.profiles;
begin
  insert into public.profiles (id, display_name, credits_remaining)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    case when private.claim_signup_grant(new.id, new.email)
         then coalesce((select signup_credits from public.pricing_settings), 30)
         else 0 end
  )
  returning * into p;
  if p.credits_remaining > 0 then
    insert into public.credit_ledger (user_id, delta, reason)
    values (new.id, p.credits_remaining, 'signup_grant');
  end if;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- referral friend bonus: same rule (unchanged otherwise)
-- ---------------------------------------------------------------------------
create or replace function public.claim_referral(p_code text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s public.pricing_settings;
  inviter uuid;
begin
  if uid is null then
    return false;
  end if;
  select * into s from public.pricing_settings;
  if not s.referral_enabled then
    return false;
  end if;
  select id into inviter from public.profiles where referral_code = lower(trim(p_code));
  if inviter is null or inviter = uid then
    return false;
  end if;
  if not exists (select 1 from public.profiles
                  where id = uid and created_at > now() - interval '1 day') then
    return false;
  end if;
  if exists (select 1 from public.credit_orders where user_id = uid and status = 'paid') then
    return false;
  end if;
  -- A second account of an inbox that already had free credits.
  if not exists (select 1 from private.signup_grants where user_id = uid) then
    return false;
  end if;
  insert into public.referrals (referred_id, referrer_id, bonus)
  values (uid, inviter, s.referral_signup_bonus)
  on conflict (referred_id) do nothing;
  if not found then
    return false;
  end if;
  if s.referral_signup_bonus > 0 then
    update public.profiles set credits_remaining = credits_remaining + s.referral_signup_bonus
     where id = uid;
    insert into public.credit_ledger (user_id, delta, reason)
    values (uid, s.referral_signup_bonus, 'referral_bonus');
  end if;
  return true;
end;
$$;
