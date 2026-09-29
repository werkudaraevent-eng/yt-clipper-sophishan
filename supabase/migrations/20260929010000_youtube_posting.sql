-- Posting clips to the user's own YouTube channel.
--
-- youtube_connections holds one Google refresh token per user, encrypted by
-- the web app (AES-GCM, key in its environment) before it reaches the
-- database. Users can see that they are connected but never read the token
-- column directly; the web app fetches it through youtube_refresh_token(),
-- which only returns the caller's own.
--
-- clip_posts records each upload so the clip card can link to the Short.

create table public.youtube_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  google_email text,
  channel_title text,
  refresh_token_enc text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.youtube_connections enable row level security;

create policy "youtube_connections: owner reads"
  on public.youtube_connections for select to authenticated
  using (user_id = auth.uid());
create policy "youtube_connections: owner disconnects"
  on public.youtube_connections for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.youtube_connections from public, anon, authenticated;
grant select (user_id, google_email, channel_title, created_at, updated_at)
  on public.youtube_connections to authenticated;
grant delete on public.youtube_connections to authenticated;

create function public.save_youtube_connection(google_email text, refresh_token_enc text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  insert into public.youtube_connections as c (user_id, google_email, refresh_token_enc)
  values (auth.uid(), google_email, refresh_token_enc)
  on conflict (user_id) do update
    set google_email = excluded.google_email,
        refresh_token_enc = excluded.refresh_token_enc,
        channel_title = null,
        updated_at = now();
end;
$$;

create function public.youtube_refresh_token()
returns text
language sql stable security definer set search_path = '' as $$
  select c.refresh_token_enc from public.youtube_connections c where c.user_id = auth.uid();
$$;

create function public.set_youtube_channel_title(title text)
returns void
language sql security definer set search_path = '' as $$
  update public.youtube_connections set channel_title = left(title, 200), updated_at = now()
   where user_id = auth.uid();
$$;

revoke execute on function public.save_youtube_connection(text, text) from public, anon;
revoke execute on function public.youtube_refresh_token() from public, anon;
revoke execute on function public.set_youtube_channel_title(text) from public, anon;
grant execute on function public.save_youtube_connection(text, text) to authenticated;
grant execute on function public.youtube_refresh_token() to authenticated;
grant execute on function public.set_youtube_channel_title(text) to authenticated;

create table public.clip_posts (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.clips (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null default 'youtube' check (platform in ('youtube')),
  status text not null default 'uploading' check (status in ('uploading', 'published', 'failed')),
  privacy text not null check (privacy in ('private', 'unlisted', 'public')),
  external_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index clip_posts_clip_idx on public.clip_posts (clip_id, created_at desc);

alter table public.clip_posts enable row level security;

create policy "clip_posts: owner reads"
  on public.clip_posts for select to authenticated
  using (user_id = auth.uid());
create policy "clip_posts: owner posts own clips"
  on public.clip_posts for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'uploading'
    and exists (
      select 1 from public.clips c join public.projects p on p.id = c.project_id
       where c.id = clip_id and p.user_id = auth.uid()
    )
  );
create policy "clip_posts: owner updates"
  on public.clip_posts for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.clip_posts from public, anon, authenticated;
grant select, insert on public.clip_posts to authenticated;
grant update (status, external_id, error, updated_at) on public.clip_posts to authenticated;
