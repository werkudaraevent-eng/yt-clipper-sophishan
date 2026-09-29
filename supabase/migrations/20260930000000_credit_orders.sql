-- Buying credits: one-time packs paid through DOKU Checkout.
--
-- The web app creates a pending order through create_credit_order(), sends
-- the user to DOKU's hosted payment page, and settles the order when DOKU
-- notifies it (or when a status check finds the payment). Settling adds the
-- credits to the ledger exactly once.
--
-- The web app talks to Postgres with the anon key only, so settling is
-- guarded by a shared token: its SHA-256 lives in private.settings (key
-- payments_token_sha256) and the plain value in the web app's
-- PAYMENTS_DB_TOKEN env var. Neither value is in this repository.

-- ---------------------------------------------------------------------------
-- packs (prices are decided here, never by the browser)
-- ---------------------------------------------------------------------------
create table public.credit_packs (
  id text primary key,
  credits integer not null check (credits > 0),
  price_idr integer not null check (price_idr > 0),
  featured boolean not null default false,
  sort_order integer not null default 0,
  active boolean not null default true
);

insert into public.credit_packs (id, credits, price_idr, featured, sort_order) values
  ('p30', 30, 19000, false, 1),
  ('p100', 100, 59000, false, 2),
  ('p300', 300, 149000, true, 3),
  ('p1000', 1000, 399000, false, 4);

alter table public.credit_packs enable row level security;
create policy "packs: read active" on public.credit_packs
  for select to anon, authenticated using (active);

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
create table public.credit_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  pack_id text not null references public.credit_packs (id),
  credits integer not null check (credits > 0),
  amount integer not null check (amount > 0),
  currency text not null default 'IDR',
  invoice_number text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'expired', 'cancelled')),
  payment_url text,
  channel text,
  pay_before timestamptz not null default now() + interval '60 minutes',
  -- Purchased credits are valid 12 months from payment.
  valid_until timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index credit_orders_user_idx on public.credit_orders (user_id, created_at desc);

alter table public.credit_orders enable row level security;
create policy "own orders: read" on public.credit_orders
  for select to authenticated using (user_id = auth.uid());

alter table public.credit_ledger
  add column order_id uuid references public.credit_orders (id) on delete set null;

-- ---------------------------------------------------------------------------
-- private settings (not exposed through the API)
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.settings (
  key text primary key,
  value text not null
);

-- ---------------------------------------------------------------------------
-- functions
-- ---------------------------------------------------------------------------

-- A pending order for one pack, for the signed-in user.
create function public.create_credit_order(p_pack text)
returns public.credit_orders
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  pack public.credit_packs;
  o public.credit_orders;
begin
  if uid is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select * into pack from public.credit_packs where id = p_pack and active;
  if not found then
    raise exception 'unknown_pack' using errcode = 'P0001';
  end if;
  -- Stop a stuck button or a script from piling up orders.
  if (select count(*) from public.credit_orders
       where user_id = uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too_many_orders' using errcode = 'P0001';
  end if;
  insert into public.credit_orders (user_id, pack_id, credits, amount, invoice_number)
  values (
    uid, pack.id, pack.credits, pack.price_idr,
    'SOF-' || to_char(now() at time zone 'Asia/Jakarta', 'YYMMDD') || '-'
      || upper(substr(md5(gen_random_uuid()::text), 1, 8))
  )
  returning * into o;
  return o;
end;
$$;

-- Remember DOKU's payment page so the user can come back to it.
create function public.attach_credit_order_payment(p_order uuid, p_url text, p_pay_before timestamptz)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_url !~ '^https://([a-z0-9-]+\.)*doku\.com/' then
    raise exception 'bad_payment_url' using errcode = 'P0001';
  end if;
  update public.credit_orders
     set payment_url = p_url,
         pay_before = coalesce(p_pay_before, pay_before),
         updated_at = now()
   where id = p_order and user_id = auth.uid() and status = 'pending';
end;
$$;

create function public.cancel_credit_order(p_order uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.credit_orders set status = 'cancelled', updated_at = now()
   where id = p_order and user_id = auth.uid() and status = 'pending';
end;
$$;

-- Apply a payment result from DOKU. SUCCESS pays the order once, whatever
-- state it was in (money arrived, so the credits are owed). FAILED and
-- EXPIRED only close a pending order. Returns the order's status.
create function public.settle_credit_order(
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

revoke execute on function public.create_credit_order(text) from public, anon;
revoke execute on function public.attach_credit_order_payment(uuid, text, timestamptz) from public, anon;
revoke execute on function public.cancel_credit_order(uuid) from public, anon;
grant execute on function public.create_credit_order(text) to authenticated;
grant execute on function public.attach_credit_order_payment(uuid, text, timestamptz) to authenticated;
grant execute on function public.cancel_credit_order(uuid) to authenticated;
-- Token-guarded; the payment webhook has no user session.
revoke execute on function public.settle_credit_order(text, text, text, text, integer) from public;
grant execute on function public.settle_credit_order(text, text, text, text, integer) to anon, authenticated;
