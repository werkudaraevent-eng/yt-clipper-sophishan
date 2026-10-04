-- Pricing from /admin: pack prices and discounts, promo codes, the sign-up
-- grant and a referral program, all set by the owner instead of in SQL.
--
--   pricing_settings  one row: sign-up credits, when pack discounts end, and
--                     the referral program. Everyone may read it (the landing
--                     page shows the sign-up credits).
--   credit_packs      gains discount_percent; the price shown struck through
--                     is price_idr.
--   promo_codes       codes typed at checkout; never readable through the API.
--   referrals         who invited whom, and whether the inviter was rewarded.
--
-- Orders keep the amount they were created with, so changing a price never
-- touches an order that already exists.

-- ---------------------------------------------------------------------------
-- settings
-- ---------------------------------------------------------------------------
create table public.pricing_settings (
  id boolean primary key default true check (id),
  signup_credits integer not null default 30 check (signup_credits between 0 and 1000),
  -- Pack discounts stop at this moment; null means they run until removed.
  discount_until timestamptz,
  referral_enabled boolean not null default false,
  -- Credits for the inviter, once per friend, after the friend's first purchase.
  referral_reward integer not null default 30 check (referral_reward between 0 and 10000),
  -- Extra credits for the friend when they sign up through an invite link.
  referral_signup_bonus integer not null default 0 check (referral_signup_bonus between 0 and 1000),
  updated_at timestamptz not null default now()
);
insert into public.pricing_settings default values;

alter table public.pricing_settings enable row level security;
create policy "pricing settings: read" on public.pricing_settings
  for select to anon, authenticated using (true);
revoke insert, update, delete, truncate, references, trigger on public.pricing_settings
  from anon, authenticated;

alter table public.credit_packs
  add column discount_percent integer not null default 0 check (discount_percent between 0 and 90);

-- What a pack costs right now: its price, less its discount while discounts run.
-- Rounded to the nearest rupiah; the web app does the same sum.
create function public.pack_price_now(p public.credit_packs) returns integer
language sql stable security definer set search_path = '' as $$
  select case
    when p.discount_percent > 0
     and coalesce((select now() < s.discount_until from public.pricing_settings s), true)
    then (p.price_idr * (100 - p.discount_percent) + 50) / 100
    else p.price_idr
  end;
$$;

-- ---------------------------------------------------------------------------
-- promo codes
-- ---------------------------------------------------------------------------
create table public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_-]{3,24}$'),
  kind text not null check (kind in ('percent', 'amount')),
  value integer not null check (value > 0),
  check (kind <> 'percent' or value <= 90),
  -- Null: any pack.
  pack_id text references public.credit_packs (id),
  -- Null: no limit.
  max_uses integer check (max_uses > 0),
  per_user_limit integer not null default 1 check (per_user_limit > 0),
  expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.promo_codes enable row level security;
revoke all on public.promo_codes from anon, authenticated;

alter table public.credit_orders
  -- The pack's normal price when the order was made (before any discount).
  add column list_amount integer,
  add column promo_code_id uuid references public.promo_codes (id) on delete set null;

-- Orders that hold a promo use: paid ones, and pending ones still payable.
create function public.promo_uses(p_promo uuid, p_user uuid default null) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.credit_orders o
   where o.promo_code_id = p_promo
     and (p_user is null or o.user_id = p_user)
     and (o.status = 'paid' or (o.status = 'pending' and o.pay_before > now()));
$$;

-- The price of a pack for the signed-in user, with an optional promo code.
-- A code that cannot be used raises promo_not_found, promo_expired,
-- promo_wrong_pack, promo_used_up, promo_already_used or promo_too_big. A
-- valid code that is not cheaper than the pack's own discount is not applied
-- (promo_applied false): codes and pack discounts never stack.
create function public.quote_credit_order(p_pack text, p_promo text default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pack public.credit_packs;
  promo public.promo_codes;
  sale integer;
  promo_price integer;
begin
  if uid is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select * into pack from public.credit_packs where id = p_pack and active;
  if not found then
    raise exception 'unknown_pack' using errcode = 'P0001';
  end if;
  sale := public.pack_price_now(pack);

  if nullif(trim(coalesce(p_promo, '')), '') is null then
    return jsonb_build_object('credits', pack.credits, 'list_amount', pack.price_idr,
      'sale_amount', sale, 'amount', sale, 'promo_code_id', null, 'promo_code', null,
      'promo_applied', false);
  end if;

  select * into promo from public.promo_codes where code = upper(trim(p_promo)) and active;
  if not found then
    raise exception 'promo_not_found' using errcode = 'P0001';
  end if;
  if promo.expires_at is not null and promo.expires_at <= now() then
    raise exception 'promo_expired' using errcode = 'P0001';
  end if;
  if promo.pack_id is not null and promo.pack_id <> pack.id then
    raise exception 'promo_wrong_pack' using errcode = 'P0001';
  end if;
  if public.promo_uses(promo.id, uid) >= promo.per_user_limit then
    raise exception 'promo_already_used' using errcode = 'P0001';
  end if;
  if promo.max_uses is not null and public.promo_uses(promo.id) >= promo.max_uses then
    raise exception 'promo_used_up' using errcode = 'P0001';
  end if;

  promo_price := case promo.kind
    when 'percent' then (pack.price_idr * (100 - promo.value) + 50) / 100
    else pack.price_idr - promo.value
  end;
  if promo_price < 1000 then
    raise exception 'promo_too_big' using errcode = 'P0001';
  end if;

  return jsonb_build_object('credits', pack.credits, 'list_amount', pack.price_idr,
    'sale_amount', sale, 'amount', least(sale, promo_price),
    'promo_code_id', case when promo_price < sale then promo.id end,
    'promo_code', promo.code, 'promo_applied', promo_price < sale);
end;
$$;

-- A pending order for one pack, for the signed-in user, at today's price.
drop function public.create_credit_order(text);
create function public.create_credit_order(p_pack text, p_promo text default null)
returns public.credit_orders
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  q jsonb;
  o public.credit_orders;
begin
  q := public.quote_credit_order(p_pack, p_promo);
  -- Stop a stuck button or a script from piling up orders.
  if (select count(*) from public.credit_orders
       where user_id = uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too_many_orders' using errcode = 'P0001';
  end if;
  insert into public.credit_orders
    (user_id, pack_id, credits, amount, list_amount, promo_code_id, invoice_number)
  values (
    uid, p_pack, (q ->> 'credits')::integer, (q ->> 'amount')::integer,
    (q ->> 'list_amount')::integer, (q ->> 'promo_code_id')::uuid,
    'SOF-' || to_char(now() at time zone 'Asia/Jakarta', 'YYMMDD') || '-'
      || upper(substr(md5(gen_random_uuid()::text), 1, 8))
  )
  returning * into o;
  return o;
end;
$$;

-- ---------------------------------------------------------------------------
-- referrals
-- ---------------------------------------------------------------------------
alter table public.profiles add column referral_code text unique;

create table public.referrals (
  referred_id uuid primary key references auth.users (id) on delete cascade,
  referrer_id uuid not null references auth.users (id) on delete cascade,
  check (referred_id <> referrer_id),
  -- Credits the friend got for signing up through the link.
  bonus integer not null default 0,
  -- Credits the inviter got; set with rewarded_at at the friend's first purchase.
  reward integer,
  rewarded_at timestamptz,
  created_at timestamptz not null default now()
);
create index referrals_referrer_idx on public.referrals (referrer_id);

alter table public.referrals enable row level security;
revoke all on public.referrals from anon, authenticated;

-- The signed-in user's invite link and how it has done. The code is made the
-- first time the program is on and the user asks for it.
create function public.my_referral() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s public.pricing_settings;
  my_code text;
begin
  if uid is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select * into s from public.pricing_settings;
  if not s.referral_enabled then
    return jsonb_build_object('enabled', false);
  end if;
  select referral_code into my_code from public.profiles where id = uid;
  if not found then
    raise exception 'no_profile' using errcode = 'P0002';
  end if;
  while my_code is null loop
    begin
      update public.profiles set referral_code = substr(md5(gen_random_uuid()::text), 1, 8)
       where id = uid
      returning referral_code into my_code;
    exception when unique_violation then
      my_code := null;
    end;
  end loop;
  return jsonb_build_object(
    'enabled', true,
    'code', my_code,
    'reward', s.referral_reward,
    'bonus', s.referral_signup_bonus,
    'invited', (select count(*) from public.referrals r where r.referrer_id = uid),
    'bought', (select count(*) from public.referrals r where r.referrer_id = uid and r.rewarded_at is not null),
    'earned', (select coalesce(sum(r.reward), 0) from public.referrals r where r.referrer_id = uid)
  );
end;
$$;

-- Link a brand-new account to the friend who invited it, and give the sign-up
-- bonus. Only within a day of signing up, only once, and never to yourself.
-- Returns whether the invite was recorded.
create function public.claim_referral(p_code text) returns boolean
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

-- Reward the inviter when an invited user's first purchase is paid. Called by
-- settle_credit_order. A first purchase made while the program is off closes
-- the invite with no reward.
create function public.reward_referral(p_buyer uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.referrals;
  s public.pricing_settings;
  credits integer;
begin
  select * into r from public.referrals where referred_id = p_buyer and rewarded_at is null for update;
  if not found then
    return;
  end if;
  select * into s from public.pricing_settings;
  credits := case when s.referral_enabled then s.referral_reward else 0 end;
  update public.referrals set reward = credits, rewarded_at = now() where referred_id = p_buyer;
  if credits > 0 then
    update public.profiles set credits_remaining = credits_remaining + credits where id = r.referrer_id;
    insert into public.credit_ledger (user_id, delta, reason)
    values (r.referrer_id, credits, 'referral_reward');
  end if;
end;
$$;

-- Same as before, plus the referral reward on a first paid order.
create or replace function public.settle_credit_order(
  p_token text, p_invoice text, p_status text, p_channel text, p_amount integer
)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  expected text;
  o public.credit_orders;
begin
  select value into expected from private.settings where key = 'payments_token_sha256';
  if expected is null or p_token is null
     or encode(extensions.digest(p_token, 'sha256'), 'hex') <> expected then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into o from public.credit_orders where invoice_number = p_invoice for update;
  if not found then
    return 'not_found';
  end if;
  if o.status = 'paid' then
    return 'paid';
  end if;

  if p_status = 'SUCCESS' then
    if p_amount is distinct from o.amount then
      raise exception 'amount_mismatch' using errcode = 'P0001';
    end if;
    update public.credit_orders
       set status = 'paid', paid_at = now(), channel = p_channel,
           valid_until = now() + interval '12 months', updated_at = now()
     where id = o.id;
    update public.profiles set credits_remaining = credits_remaining + o.credits
     where id = o.user_id;
    insert into public.credit_ledger (user_id, delta, reason, order_id)
    values (o.user_id, o.credits, 'purchase', o.id);
    perform public.reward_referral(o.user_id);
    return 'paid';
  end if;

  if p_status in ('FAILED', 'EXPIRED') and o.status = 'pending' then
    update public.credit_orders
       set status = lower(p_status), channel = coalesce(p_channel, channel), updated_at = now()
     where id = o.id;
    return lower(p_status);
  end if;

  return o.status;
end;
$$;

-- ---------------------------------------------------------------------------
-- sign-up grant from the settings, plus nothing when it is zero
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
    coalesce((select signup_credits from public.pricing_settings), 30)
  )
  returning * into p;
  if p.credits_remaining > 0 then
    insert into public.credit_ledger (user_id, delta, reason)
    values (new.id, p.credits_remaining, 'signup_grant');
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- /admin: admins read, the owner writes
-- ---------------------------------------------------------------------------
create function public.admin_pricing() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'packs', coalesce((select jsonb_agg(to_jsonb(p) order by p.sort_order, p.credits)
                         from public.credit_packs p), '[]'::jsonb),
    'settings', (select to_jsonb(s) - 'id' from public.pricing_settings s),
    'promos', coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object(
                                 'uses', (select count(*) from public.credit_orders o
                                           where o.promo_code_id = c.id and o.status = 'paid'))
                               order by c.created_at desc)
                          from public.promo_codes c), '[]'::jsonb),
    'referrals', jsonb_build_object(
      'invited', (select count(*) from public.referrals),
      'bought', (select count(*) from public.referrals where rewarded_at is not null),
      'credits', (select coalesce(sum(reward), 0) + coalesce(sum(bonus), 0) from public.referrals)
    )
  );
end;
$$;

-- Save packs and settings in one go. p_packs is an array of
-- {id?, credits, price_idr, discount_percent, featured, active}; its order is
-- the display order, and an element without id is a new pack. Packs left out
-- are not touched (they can be hidden, never deleted: orders point at them).
create function public.admin_save_pricing(p_packs jsonb, p_settings jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  e jsonb;
  i integer := 0;
  pid text;
begin
  if not public.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if jsonb_typeof(p_packs) <> 'array' then
    raise exception 'bad_packs' using errcode = '22023';
  end if;
  for e in select * from jsonb_array_elements(p_packs) loop
    i := i + 1;
    if (e ->> 'price_idr')::integer < 1000 then
      raise exception 'price_too_low' using errcode = '22023';
    end if;
    if ((e ->> 'price_idr')::integer * (100 - coalesce((e ->> 'discount_percent')::integer, 0)) + 50) / 100 < 1000 then
      raise exception 'price_too_low' using errcode = '22023';
    end if;
    pid := nullif(e ->> 'id', '');
    if pid is null then
      pid := 'p' || (e ->> 'credits') || '-' || substr(md5(gen_random_uuid()::text), 1, 4);
      insert into public.credit_packs (id, credits, price_idr, discount_percent, featured, active, sort_order)
      values (pid, (e ->> 'credits')::integer, (e ->> 'price_idr')::integer,
              coalesce((e ->> 'discount_percent')::integer, 0),
              coalesce((e ->> 'featured')::boolean, false), coalesce((e ->> 'active')::boolean, true), i);
    else
      update public.credit_packs
         set credits = (e ->> 'credits')::integer,
             price_idr = (e ->> 'price_idr')::integer,
             discount_percent = coalesce((e ->> 'discount_percent')::integer, 0),
             featured = coalesce((e ->> 'featured')::boolean, false),
             active = coalesce((e ->> 'active')::boolean, true),
             sort_order = i
       where id = pid;
      if not found then
        raise exception 'unknown_pack' using errcode = 'P0001';
      end if;
    end if;
  end loop;
  if (select count(*) from public.credit_packs where featured) > 1 then
    raise exception 'one_featured' using errcode = '22023';
  end if;
  if not exists (select 1 from public.credit_packs where active) then
    raise exception 'no_active_pack' using errcode = '22023';
  end if;

  if p_settings is not null then
    update public.pricing_settings set
      signup_credits = coalesce((p_settings ->> 'signup_credits')::integer, signup_credits),
      discount_until = case when p_settings ? 'discount_until'
                            then (p_settings ->> 'discount_until')::timestamptz else discount_until end,
      referral_enabled = coalesce((p_settings ->> 'referral_enabled')::boolean, referral_enabled),
      referral_reward = coalesce((p_settings ->> 'referral_reward')::integer, referral_reward),
      referral_signup_bonus = coalesce((p_settings ->> 'referral_signup_bonus')::integer, referral_signup_bonus),
      updated_at = now();
  end if;
end;
$$;

-- Create a promo code, or change one (p ->> 'id'). Returns its id.
create function public.admin_save_promo(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  pid uuid := nullif(p ->> 'id', '')::uuid;
begin
  if not public.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if pid is null then
    insert into public.promo_codes (code, kind, value, pack_id, max_uses, per_user_limit, expires_at, active)
    values (upper(trim(p ->> 'code')), p ->> 'kind', (p ->> 'value')::integer, nullif(p ->> 'pack_id', ''),
            (p ->> 'max_uses')::integer, coalesce((p ->> 'per_user_limit')::integer, 1),
            (p ->> 'expires_at')::timestamptz, coalesce((p ->> 'active')::boolean, true))
    returning id into pid;
  else
    update public.promo_codes set
      code = upper(trim(p ->> 'code')),
      kind = p ->> 'kind',
      value = (p ->> 'value')::integer,
      pack_id = nullif(p ->> 'pack_id', ''),
      max_uses = (p ->> 'max_uses')::integer,
      per_user_limit = coalesce((p ->> 'per_user_limit')::integer, 1),
      expires_at = (p ->> 'expires_at')::timestamptz,
      active = coalesce((p ->> 'active')::boolean, active)
     where id = pid;
    if not found then
      raise exception 'unknown_promo' using errcode = 'P0001';
    end if;
  end if;
  return pid;
end;
$$;

create function public.admin_set_promo_active(p_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  update public.promo_codes set active = p_active where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- grants
-- ---------------------------------------------------------------------------
revoke execute on function public.pack_price_now(public.credit_packs) from public, anon, authenticated;
revoke execute on function public.promo_uses(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.reward_referral(uuid) from public, anon, authenticated;
revoke execute on function public.quote_credit_order(text, text) from public, anon;
revoke execute on function public.create_credit_order(text, text) from public, anon;
revoke execute on function public.my_referral() from public, anon;
revoke execute on function public.claim_referral(text) from public, anon;
revoke execute on function public.admin_pricing() from public, anon;
revoke execute on function public.admin_save_pricing(jsonb, jsonb) from public, anon;
revoke execute on function public.admin_save_promo(jsonb) from public, anon;
revoke execute on function public.admin_set_promo_active(uuid, boolean) from public, anon;
grant execute on function public.quote_credit_order(text, text) to authenticated;
grant execute on function public.create_credit_order(text, text) to authenticated;
grant execute on function public.my_referral() to authenticated;
grant execute on function public.claim_referral(text) to authenticated;
grant execute on function public.admin_pricing() to authenticated;
grant execute on function public.admin_save_pricing(jsonb, jsonb) to authenticated;
grant execute on function public.admin_save_promo(jsonb) to authenticated;
grant execute on function public.admin_set_promo_active(uuid, boolean) to authenticated;
