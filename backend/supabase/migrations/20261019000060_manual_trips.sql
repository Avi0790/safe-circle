-- Share a bus, train or flight. Unlike a drive or a walk, nothing in the app is
-- navigating, so nothing keeps reporting: the person says where they're going
-- and when they expect to arrive, and the circle sees it. (A phone on a plane
-- is in airplane mode for hours; "no word for 10 minutes means stale" would
-- hide the trip the moment the doors close.)
--
-- So these "manual" trips follow a different rule: they stay visible until the
-- arrival time plus a grace period for delays, then fade out by themselves.
-- Drives and walks keep the 10-minute quiet rule. Everything else is the same
-- as any shared trip: destination NAME and ETA only, no route, Ghost mode and
-- sharing windows apply, one active trip per person.
alter table public.shared_trips drop constraint shared_trips_mode_check;
alter table public.shared_trips
  add constraint shared_trips_mode_check check (mode in ('drive', 'walk', 'bus', 'train', 'flight'));

-- How long after its ETA a manual trip stays up, for delays. NULL means the
-- trip is live-tracked (drive, walk) and uses the quiet-phone rule instead.
-- Internal: the app has its own copy of these numbers (lib/sharedTrips.ts).
create function public.manual_trip_grace(p_mode text)
returns interval
language sql
immutable
as $$
  select case p_mode
    when 'bus' then interval '30 minutes'
    when 'train' then interval '45 minutes'
    when 'flight' then interval '2 hours'
  end
$$;
revoke all on function public.manual_trip_grace(text) from public, anon, authenticated;

-- "25 min", "1 h 40 min", "4 h": a flight is not "arriving in about 245 min".
create function public.trip_duration_text(p_minutes int)
returns text
language sql
immutable
as $$
  select case
    when p_minutes < 90 then p_minutes || ' min'
    when p_minutes % 60 = 0 then (p_minutes / 60) || ' h'
    else (p_minutes / 60) || ' h ' || (p_minutes % 60) || ' min'
  end
$$;
revoke all on function public.trip_duration_text(int) from public, anon, authenticated;

create or replace function public.start_shared_trip(
  p_circle_id uuid,
  p_destination text,
  p_eta timestamptz,
  p_mode text default 'drive'
)
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
  max_ahead interval;
  title text;
  verb text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_member_of(p_circle_id) then
    raise exception 'Not a member of this circle.';
  end if;
  if p_mode is null or p_mode not in ('drive', 'walk', 'bus', 'train', 'flight') then
    raise exception 'Choose driving, walking, bus, train or flight.';
  end if;
  if dest is null or char_length(dest) < 1 or char_length(dest) > 80 then
    raise exception 'Give the destination a name of 1 to 80 characters.';
  end if;
  -- A long-haul flight with a layover can be more than a day.
  max_ahead := case when p_mode = 'flight' then interval '48 hours' else interval '24 hours' end;
  if p_eta is null or p_eta < now() - interval '1 minute' or p_eta > now() + max_ahead then
    raise exception 'The arrival time must be within the next % hours.', extract(epoch from max_ahead)::int / 3600;
  end if;

  -- Starting a new trip ends any earlier one still open.
  update public.shared_trips set status = 'ended', ended_at = now()
  where user_id = auth.uid() and status = 'active';

  insert into public.shared_trips (user_id, circle_id, destination, eta, mode)
  values (auth.uid(), p_circle_id, dest, p_eta, p_mode)
  returning id into new_id;

  -- Relative minutes, not a clock time: the server doesn't know each
  -- recipient's time zone.
  mins := greatest(1, ceil(extract(epoch from p_eta - now()) / 60)::int);
  select full_name into who_name from public.profiles where id = auth.uid();
  title := case p_mode
    when 'walk' then '🚶 ' || who_name || ' is walking'
    when 'bus' then '🚌 ' || who_name || ' is on the bus'
    when 'train' then '🚆 ' || who_name || ' is on the train'
    when 'flight' then '✈️ ' || who_name || ' is flying'
    else '🚗 ' || who_name || ' is on the way'
  end;
  verb := case p_mode
    when 'walk' then 'Walking to '
    when 'flight' then 'Flying to '
    else 'Heading to '
  end;
  perform public.send_alert_push(
    public.trip_recipients(p_circle_id, auth.uid()),
    title,
    verb || dest || ', ' || case when p_mode = 'flight' then 'landing' else 'arriving' end
      || ' in about ' || public.trip_duration_text(mins) || '.',
    jsonb_build_object('type', 'shared_trip', 'tripId', new_id, 'circleId', p_circle_id)
  );

  return new_id;
end;
$$;

-- The ETA of a trip you are running late for. The upper bound depends on the
-- kind of trip, so look the mode up first (a trip that isn't yours or isn't
-- active simply matches nothing below, as before).
create or replace function public.update_shared_trip(p_trip uuid, p_eta timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  trip_mode text;
  max_ahead interval;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select mode into trip_mode from public.shared_trips
  where id = p_trip and user_id = auth.uid() and status = 'active';
  max_ahead := case when trip_mode = 'flight' then interval '48 hours' else interval '24 hours' end;
  if p_eta is null or p_eta < now() - interval '1 minute' or p_eta > now() + max_ahead then
    raise exception 'The arrival time must be within the next % hours.', extract(epoch from max_ahead)::int / 3600;
  end if;

  -- At most one update every 15 seconds per trip, so a chatty client can't
  -- turn this into a stream of writes everyone's phone has to react to.
  update public.shared_trips
  set eta = p_eta, updated_at = now()
  where id = p_trip and user_id = auth.uid() and status = 'active'
    and updated_at <= now() - interval '15 seconds';
end;
$$;

-- Every 5 minutes (existing cron job). A drive or walk nobody has heard from in
-- 10 minutes is no longer live; a bus, train or flight is over once its ETA
-- plus the grace for delays has passed. Finished trips are deleted after 2 days.
create or replace function public.expire_stale_trips()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update public.shared_trips set status = 'stale', ended_at = now()
  where status = 'active'
    and case
      when public.manual_trip_grace(mode) is null then updated_at < now() - interval '10 minutes'
      else eta + public.manual_trip_grace(mode) < now()
    end;
  get diagnostics n = row_count;

  delete from public.shared_trips
  where status <> 'active' and coalesce(ended_at, started_at) < now() - interval '2 days';
  return n;
end;
$$;
