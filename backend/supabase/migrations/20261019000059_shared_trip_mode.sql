-- Share my ETA for walks. Directions now has a Walk mode, so a shared trip
-- says whether the person is driving or walking: circle-mates see "🚶 Sam is
-- walking to the library" rather than a car, and the push says the same.
-- Nothing else about sharing changes (destination name and ETA only, Ghost
-- mode and sharing windows apply, one active trip per person).
alter table public.shared_trips
  add column mode text not null default 'drive' check (mode in ('drive', 'walk'));

-- Adding a parameter creates an overload rather than replacing the function,
-- and a leftover three-argument version would be a second way in that skips
-- the new validation, so drop it. The new parameter has a default, so an app
-- that hasn't updated yet and still calls with three arguments keeps working
-- (as a drive).
drop function public.start_shared_trip(uuid, text, timestamptz);

create function public.start_shared_trip(
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
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_member_of(p_circle_id) then
    raise exception 'Not a member of this circle.';
  end if;
  if p_mode is null or p_mode not in ('drive', 'walk') then
    raise exception 'Choose driving or walking.';
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

  insert into public.shared_trips (user_id, circle_id, destination, eta, mode)
  values (auth.uid(), p_circle_id, dest, p_eta, p_mode)
  returning id into new_id;

  -- Relative minutes, not a clock time: the server doesn't know each
  -- recipient's time zone.
  mins := greatest(1, ceil(extract(epoch from p_eta - now()) / 60)::int);
  select full_name into who_name from public.profiles where id = auth.uid();
  perform public.send_alert_push(
    public.trip_recipients(p_circle_id, auth.uid()),
    case when p_mode = 'walk' then '🚶 ' || who_name || ' is walking' else '🚗 ' || who_name || ' is on the way' end,
    case when p_mode = 'walk' then 'Walking to ' else 'Heading to ' end
      || dest || ', arriving in about ' || mins || ' min.',
    jsonb_build_object('type', 'shared_trip', 'tripId', new_id, 'circleId', p_circle_id)
  );

  return new_id;
end;
$$;

-- A new function starts with Supabase's default grants, which include anon and
-- authenticated; revoke explicitly, then allow only signed-in users.
revoke all on function public.start_shared_trip(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.start_shared_trip(uuid, text, timestamptz, text) to authenticated;
