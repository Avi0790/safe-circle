-- "Who looked at my location" — a log of when a circle-mate opened your
-- location history (the member detail screen), so watching someone isn't
-- invisible. Life360 has no equivalent; this is a privacy feature aimed
-- squarely at the "always watching, never accountable" criticism the
-- README's Life360-comparison notes raise.
--
-- Deliberately scoped to opening the *detail* screen (a specific look-up),
-- not every glance at the live map — the map already shows everyone's dot
-- continuously, so logging that would just be noise, not a meaningful signal.
create table public.location_views (
  id bigint generated always as identity primary key,
  viewer_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  viewed_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (viewer_id <> viewed_id)
);

create index location_views_viewed_idx on public.location_views (viewed_id, created_at desc);

alter table public.location_views enable row level security;

-- You can see who viewed you, and your own viewing history (so "who did I
-- check on" and "who checked on me" are both covered) — nobody else's.
create policy "location_views_select"
  on public.location_views for select
  using (viewer_id = auth.uid() or viewed_id = auth.uid());

-- record_location_view() is the only writer (see below); no direct insert
-- policy, so a client can't backdate a view or log one for someone else's
-- (viewer_id, viewed_id) pair.

-- Logs a view, but at most one row per (viewer, viewed) pair per 15
-- minutes — reopening the same person's screen a few times in a row (or a
-- screen re-mounting) shouldn't read as five separate check-ins.
create function public.record_location_view(p_viewed_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_viewed_id = auth.uid() then
    return;
  end if;
  if not public.shares_circle_with(p_viewed_id) then
    raise exception 'Not in a shared circle.';
  end if;

  if exists (
    select 1 from public.location_views
    where viewer_id = auth.uid() and viewed_id = p_viewed_id
      and created_at > now() - interval '15 minutes'
  ) then
    return;
  end if;

  insert into public.location_views (viewer_id, viewed_id) values (auth.uid(), p_viewed_id);
end;
$$;

revoke all on function public.record_location_view(uuid) from public, anon;
grant execute on function public.record_location_view(uuid) to authenticated;
