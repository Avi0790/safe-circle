-- Share my ETA. While driving with in-app directions, someone can choose to let
-- their circle see where they're headed and when they expect to arrive, and to
-- be told when they get there. Opt-in per trip, scoped to one circle (the way
-- Walk me home is), and it shares only the destination's NAME, an ETA and the
-- status: no route, and no destination coordinates.
--
-- It respects the same privacy rules as seeing someone's location: if you've
-- hidden from a person (Ghost mode) they can't see your trip or get a push
-- about it, and if your sharing window has ended nobody can. The existing
-- circle_recipients() helper used by walks and timers ignores Ghost mode, so
-- trips use their own stricter recipient list rather than inheriting that.
create table public.shared_trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  circle_id uuid not null references public.circles (id) on delete cascade,
  destination text not null check (char_length(trim(destination)) between 1 and 80),
  eta timestamptz not null,
  -- active: driving now; arrived / ended: finished (the driver said so);
  -- stale: the phone stopped reporting, so nobody is left looking at an old ETA.
  status text not null default 'active' check (status in ('active', 'arrived', 'ended', 'stale')),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);

create unique index shared_trips_one_active_per_user on public.shared_trips (user_id) where status = 'active';
create index shared_trips_circle_idx on public.shared_trips (circle_id, status);

alter table public.shared_trips enable row level security;

-- Same visibility rule as a person's live location: you, or a circle-mate who
-- you haven't hidden from, while you're sharing. No write policies; the
-- functions below are the only way a row changes.
create policy "shared_trips_select"
  on public.shared_trips for select
  using (
    user_id = auth.uid()
    or (
      public.is_member_of(circle_id)
      and public.is_sharing(user_id)
      and not public.is_hidden_by(user_id)
    )
  );

alter publication supabase_realtime add table public.shared_trips;

-- Who gets the push: the rest of the circle, minus anyone the driver hid from,
-- and nobody at all if the driver isn't sharing right now.
create function public.trip_recipients(p_circle uuid, p_user uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not public.is_sharing(p_user) then '{}'::uuid[]
    else coalesce((
      select array_agg(m.user_id)
      from public.circle_members m
      where m.circle_id = p_circle
        and m.user_id <> p_user
        and not exists (
          select 1 from public.hidden_from h
          where h.owner_id = p_user and h.hidden_from_id = m.user_id
        )
    ), '{}'::uuid[])
  end;
$$;

create function public.start_shared_trip(p_circle_id uuid, p_destination text, p_eta timestamptz)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  who_name text;
  dest text := trim(p_destination);
  mins int;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_member_of(p_circle_id) then
    raise exception 'Not a member of this circle.';
  end if;
  if dest is null or char_length(dest) < 1 or char_length(dest) > 80 then
    raise exception 'Give the destination a name of 1 to 80 characters.';
  end if;
  if p_eta is null or p_eta < now() - interval '1 minute' or p_eta > now() + interval '24 hours' then
    raise exception 'The arrival time must be within the next 24 hours.';
  end if;

  -- Starting a new trip ends any earlier one still open.
  update public.shared_trips set status = 'ended', ended_at = now()
  where user_id = auth.uid() and status = 'active';

  insert into public.shared_trips (user_id, circle_id, destination, eta)
  values (auth.uid(), p_circle_id, dest, p_eta)
  returning id into new_id;

  -- Relative minutes, not a clock time: the server doesn't know each
  -- recipient's time zone.
  mins := greatest(1, ceil(extract(epoch from p_eta - now()) / 60)::int);
  select full_name into who_name from public.profiles where id = auth.uid();
  perform public.send_alert_push(
    public.trip_recipients(p_circle_id, auth.uid()),
    '🚗 ' || who_name || ' is on the way',
    'Heading to ' || dest || ', arriving in about ' || mins || ' min.',
    jsonb_build_object('type', 'shared_trip', 'tripId', new_id, 'circleId', p_circle_id)
  );

  return new_id;
end;
$$;

create function public.update_shared_trip(p_trip uuid, p_eta timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_eta is null or p_eta < now() - interval '1 minute' or p_eta > now() + interval '24 hours' then
    raise exception 'The arrival time must be within the next 24 hours.';
  end if;

  -- At most one update every 15 seconds per trip, so a chatty client can't
  -- turn this into a stream of writes everyone's phone has to react to.
  update public.shared_trips
  set eta = p_eta, updated_at = now()
  where id = p_trip and user_id = auth.uid() and status = 'active'
    and updated_at <= now() - interval '15 seconds';
end;
$$;

create function public.end_shared_trip(p_trip uuid, p_arrived boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.shared_trips;
  who_name text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  update public.shared_trips
  set status = case when p_arrived then 'arrived' else 'ended' end, ended_at = now(), updated_at = now()
  where id = p_trip and user_id = auth.uid() and status = 'active'
  returning * into t;

  -- Only a real arrival is announced; stopping a trip just makes it vanish.
  if found and p_arrived then
    select full_name into who_name from public.profiles where id = auth.uid();
    perform public.send_alert_push(
      public.trip_recipients(t.circle_id, auth.uid()),
      '✅ ' || who_name || ' arrived',
      'They got to ' || t.destination || '.',
      jsonb_build_object('type', 'shared_trip', 'tripId', t.id, 'circleId', t.circle_id)
    );
  end if;
end;
$$;

-- Run every 5 minutes: a trip nobody has heard from in 10 minutes is no longer
-- live (dead battery, no signal, app closed), and finished trips are deleted
-- after 2 days: where someone drove is not something to keep.
create function public.expire_stale_trips()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update public.shared_trips set status = 'stale', ended_at = now()
  where status = 'active' and updated_at < now() - interval '10 minutes';
  get diagnostics n = row_count;

  delete from public.shared_trips
  where status <> 'active' and coalesce(ended_at, started_at) < now() - interval '2 days';
  return n;
end;
$$;

select cron.schedule('expire-stale-trips', '*/5 * * * *', 'select public.expire_stale_trips()');

-- Internal helpers are not callable through the API (migration ...000055).
revoke all on function public.trip_recipients(uuid, uuid) from public, anon, authenticated;
revoke all on function public.expire_stale_trips() from public, anon, authenticated;
revoke all on function public.start_shared_trip(uuid, text, timestamptz) from public, anon;
revoke all on function public.update_shared_trip(uuid, timestamptz) from public, anon;
revoke all on function public.end_shared_trip(uuid, boolean) from public, anon;
grant execute on function public.start_shared_trip(uuid, text, timestamptz) to authenticated;
grant execute on function public.update_shared_trip(uuid, timestamptz) to authenticated;
grant execute on function public.end_shared_trip(uuid, boolean) to authenticated;

-- "Download my data" includes the trips you shared. Everything else is
-- unchanged from migration ...000054.
create or replace function public.export_my_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  return jsonb_build_object(
    'exported_at', now(),
    'note', 'Locations are limited to your newest 5000 points.',
    'profile', (select to_jsonb(p) from public.profiles p where p.id = uid),
    'circles', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'you_created_it', c.created_by = uid, 'joined_at', cm.joined_at
      )), '[]'::jsonb)
      from public.circle_members cm join public.circles c on c.id = cm.circle_id
      where cm.user_id = uid
    ),
    'locations', (
      select coalesce(jsonb_agg(to_jsonb(l) - 'id' - 'user_id' order by l.recorded_at desc), '[]'::jsonb)
      from (select * from public.locations where user_id = uid order by recorded_at desc limit 5000) l
    ),
    'places_you_created', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', name, 'latitude', latitude, 'longitude', longitude, 'radius_meters', radius_meters
      )), '[]'::jsonb)
      from public.places where created_by = uid
    ),
    'messages', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'body', body, 'latitude', latitude, 'longitude', longitude, 'created_at', created_at
      ) order by created_at desc), '[]'::jsonb)
      from public.messages where user_id = uid
    ),
    'sos_events', (select coalesce(jsonb_agg(to_jsonb(s) - 'user_id'), '[]'::jsonb) from public.sos_events s where s.user_id = uid),
    'walks', (select coalesce(jsonb_agg(to_jsonb(w) - 'user_id'), '[]'::jsonb) from public.walks w where w.user_id = uid),
    'safety_timers', (select coalesce(jsonb_agg(to_jsonb(t) - 'user_id'), '[]'::jsonb) from public.safety_timers t where t.user_id = uid),
    'ride_requests', (select coalesce(jsonb_agg(to_jsonb(r) - 'user_id'), '[]'::jsonb) from public.ride_requests r where r.user_id = uid),
    'medical_card', (select to_jsonb(m) - 'user_id' from public.medical_cards m where m.user_id = uid),
    'curfew', (select to_jsonb(cu) - 'user_id' from public.curfews cu where cu.user_id = uid),
    'backup_contacts', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'phone_number', phone_number)), '[]'::jsonb) from public.backup_contacts where user_id = uid),
    'people_you_hide_from', (
      select coalesce(jsonb_agg(p.full_name), '[]'::jsonb)
      from public.hidden_from h join public.profiles p on p.id = h.hidden_from_id where h.owner_id = uid
    ),
    'guest_links', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'created_at', created_at, 'expires_at', expires_at, 'revoked_at', revoked_at, 'view_count', view_count
      )), '[]'::jsonb)
      from public.share_links where user_id = uid
    ),
    'who_viewed_your_history', (
      select coalesce(jsonb_agg(jsonb_build_object('viewer', p.full_name, 'at', v.created_at) order by v.created_at desc), '[]'::jsonb)
      from public.location_views v join public.profiles p on p.id = v.viewer_id where v.viewed_id = uid
    ),
    'organizations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'organization', o.name,
        'role', m.role,
        'status', m.status,
        'joined_at', m.joined_at,
        'consented_at', m.consented_at,
        'consented_to_disclosure_version', m.consent_version,
        'teams', (
          select coalesce(jsonb_agg(jsonb_build_object('team', t.name, 'is_lead', tm.is_lead)), '[]'::jsonb)
          from public.team_members tm join public.teams t on t.id = tm.team_id
          where tm.user_id = uid and t.org_id = m.org_id
        )
      ) order by o.name), '[]'::jsonb)
      from public.org_members m join public.organizations o on o.id = m.org_id
      where m.user_id = uid
    ),
    'work_shifts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'organization', o.name,
        'clocked_in_at', s.clocked_in_at,
        'clocked_out_at', s.clocked_out_at,
        'check_in_every_minutes', s.checkin_minutes,
        'last_check_in_at', s.last_checkin_at
      ) order by s.clocked_in_at desc), '[]'::jsonb)
      from public.shifts s join public.organizations o on o.id = s.org_id
      where s.user_id = uid
    ),
    'who_looked_at_you_at_work', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'organization', o.name, 'viewer', p.full_name, 'action', a.action, 'at', a.created_at
      ) order by a.created_at desc), '[]'::jsonb)
      from public.org_audit a
      join public.organizations o on o.id = a.org_id
      left join public.profiles p on p.id = a.actor_id
      where a.target_id = uid and a.actor_id is distinct from uid
    ),
    'shared_trips', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'circle', c.name, 'destination', t.destination, 'estimated_arrival', t.eta,
        'status', t.status, 'started_at', t.started_at, 'ended_at', t.ended_at
      ) order by t.started_at desc), '[]'::jsonb)
      from public.shared_trips t join public.circles c on c.id = t.circle_id
      where t.user_id = uid
    )
  );
end;
$$;
