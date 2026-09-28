-- Admins: sign-up date, project count and recent credit history of one user,
-- shown next to the balance on /admin. Users can only read their own ledger
-- through RLS, so this goes through a security definer that checks is_admin().

create function public.admin_user_overview(target_user uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'created_at', (select u.created_at from auth.users u where u.id = target_user),
    'projects', (select count(*) from public.projects p where p.user_id = target_user),
    'ledger', coalesce((
      select jsonb_agg(row_to_json(l) order by l.created_at desc)
        from (
          select c.id, c.delta, c.reason, c.created_at, c.project_id, p.title as project_title
            from public.credit_ledger c
            left join public.projects p on p.id = c.project_id
           where c.user_id = target_user
           order by c.created_at desc
           limit 20
        ) l
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.admin_user_overview(uuid) from public, anon;
grant execute on function public.admin_user_overview(uuid) to authenticated;
