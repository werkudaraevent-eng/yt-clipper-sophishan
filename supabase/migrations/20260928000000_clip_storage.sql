-- Private bucket for rendered clips, laid out as <user id>/<project id>/<file>.
-- Users can read their own folder; only the worker (service role) writes.
-- Skipped on plain Postgres (docker compose, CI), which has no storage schema.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('clips', 'clips', false, 524288000, array['video/mp4', 'image/jpeg'])
    on conflict (id) do nothing;

    execute $policy$
      create policy "clips: owner can read"
        on storage.objects for select to authenticated
        using (bucket_id = 'clips' and (storage.foldername(name))[1] = auth.uid()::text)
    $policy$;
  end if;
end
$$;
