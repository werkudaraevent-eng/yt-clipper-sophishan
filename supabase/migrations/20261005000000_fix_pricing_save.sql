-- Saving on the admin Pricing tab failed with "Could not save the change".
-- Supabase loads pg-safeupdate for API sessions, which rejects an UPDATE with
-- no WHERE clause, even inside a security definer function. The one-row
-- pricing_settings update had none; it now names its row.
create or replace function public.admin_save_pricing(p_packs jsonb, p_settings jsonb) returns void
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
      updated_at = now()
    where id;
  end if;
end;
$$;
