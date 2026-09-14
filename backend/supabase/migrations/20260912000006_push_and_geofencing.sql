-- Stretch goal: geofenced places with arrive/leave alerts (proposal page 3).
-- New tables: places (geofences), place_membership_state (bookkeeping so we
-- can detect a *transition*, not just "currently inside"), geofence_events
-- (the arrive/leave log an Edge Function turns into a push notification),
-- and push_tokens (where to send it).

create table public.places (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  radius_meters double precision not null default 100,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index places_circle_idx on public.places (circle_id);

-- One row per (place, user): are they currently inside it? Updated by the
-- trigger below every time a new location ping arrives.
create table public.place_membership_state (
  place_id uuid not null references public.places (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  is_inside boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (place_id, user_id)
);

create table public.geofence_events (
  id bigint generated always as identity primary key,
  place_id uuid not null references public.places (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_type text not null check (event_type in ('arrived', 'left')),
  occurred_at timestamptz not null default now(),
  notified boolean not null default false
);

create index geofence_events_place_idx on public.geofence_events (place_id, occurred_at desc);

-- Expo/FCM push tokens. A user can have more than one (phone + tablet).
create table public.push_tokens (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('ios', 'android', 'web')),
  created_at timestamptz not null default now(),
  primary key (user_id, token)
);

-- Great-circle distance in meters. Plain SQL so we don't need PostGIS/
-- earthdistance for one formula.
create function public.haversine_meters(
  lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision
)
returns double precision
language sql
immutable
as $$
  select 6371000 * 2 * asin(sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2 +
    cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lon2 - lon1) / 2) ^ 2
  ));
$$;

-- Fires after every location insert. Checks the reporting user's position
-- against every place in circles they belong to; on an inside/outside
-- transition, records the new state and logs an event for the push
-- notification Edge Function to pick up.
create function public.evaluate_geofences()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  now_inside boolean;
  was_inside boolean;
begin
  for p in
    select pl.id, pl.latitude, pl.longitude, pl.radius_meters
    from public.places pl
    join public.circle_members cm on cm.circle_id = pl.circle_id
    where cm.user_id = new.user_id
  loop
    now_inside := public.haversine_meters(new.latitude, new.longitude, p.latitude, p.longitude) <= p.radius_meters;

    select is_inside into was_inside
    from public.place_membership_state
    where place_id = p.id and user_id = new.user_id;

    if was_inside is null then
      was_inside := false;
    end if;

    if now_inside <> was_inside then
      insert into public.place_membership_state (place_id, user_id, is_inside, updated_at)
      values (p.id, new.user_id, now_inside, new.recorded_at)
      on conflict (place_id, user_id)
        do update set is_inside = excluded.is_inside, updated_at = excluded.updated_at;

      insert into public.geofence_events (place_id, user_id, event_type, occurred_at)
      values (p.id, new.user_id, case when now_inside then 'arrived' else 'left' end, new.recorded_at);
    end if;
  end loop;

  return new;
end;
$$;

create trigger locations_evaluate_geofences
  after insert on public.locations
  for each row execute function public.evaluate_geofences();

alter table public.places enable row level security;
alter table public.place_membership_state enable row level security;
alter table public.geofence_events enable row level security;
alter table public.push_tokens enable row level security;

-- places: visible to circle members; managed by whoever created them.
create policy "places_select_members"
  on public.places for select
  using (public.is_member_of(circle_id));

create policy "places_insert_member"
  on public.places for insert
  with check (public.is_member_of(circle_id) and created_by = auth.uid());

create policy "places_update_creator"
  on public.places for update
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

create policy "places_delete_creator"
  on public.places for delete
  using (created_by = auth.uid());

-- place_membership_state / geofence_events: read-only for clients (the
-- security definer trigger above is the only writer). Visible to the
-- person themself and anyone who shares a circle with them, same rule as
-- locations.
create policy "place_membership_state_select"
  on public.place_membership_state for select
  using (user_id = auth.uid() or public.shares_circle_with(user_id));

create policy "geofence_events_select"
  on public.geofence_events for select
  using (user_id = auth.uid() or public.shares_circle_with(user_id));

-- push_tokens: strictly private to the owning device/user. The
-- send-geofence-push Edge Function reads these with the service_role key,
-- which bypasses RLS entirely.
create policy "push_tokens_manage_own"
  on public.push_tokens for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter publication supabase_realtime add table public.geofence_events;
