-- Ghost mode and sharing windows now apply to routine activity pushes.
--
-- circle_recipients() (migration ...000026) returns every other circle member,
-- so hiding from someone (Ghost mode) or ending your sharing window did not
-- stop them being told "X is walking home", "X asked to be checked on" or
-- "X dropped a pin" -- which reveals exactly the activity hiding is meant to
-- keep private. Shared trips (...000057) already avoided this with
-- trip_recipients(); walks, Check on me and pins now do the same through
-- routine_recipients().
--
-- Emergencies are deliberately NOT changed: SOS, and the automatic SOS a
-- walk or check-on-me raises when overdue (expire_walks / expire_safety_timers
-- insert into sos_events), keep going to everyone through
-- circle_recipients_all(). Hiding from someone must never stop them hearing
-- that you may be in danger.
--
-- One consequence is handled explicitly: if a walk or timer was already
-- overdue, the circle (including anyone hidden from) was sent an SOS, so the
-- all-clear ("is safe" / "checked in" / "arrived safely") goes to the same
-- people instead of leaving the hidden person believing it is still open.
-- circle_recipients() is kept for that case.

-- Who gets a routine activity push: the rest of the circle, minus anyone the
-- sender hid from, and nobody at all if the sender isn't sharing right now.
create function public.routine_recipients(p_circle uuid, p_user uuid)
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

-- Internal: not callable through the API (revoking from public/anon alone
-- leaves the authenticated grant, so name it explicitly).
revoke all on function public.routine_recipients(uuid, uuid) from public, anon, authenticated;

-- ===== Walk me home =====
-- Only the recipient lists change; everything else is as in ...000026.

create or replace function public.start_walk(p_place_id uuid, p_minutes int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  pl public.places;
  walker_name text;
  old_id uuid;
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_minutes is null or p_minutes < 5 or p_minutes > 180 then
    raise exception 'Choose between 5 and 180 minutes.';
  end if;

  select * into pl from public.places where id = p_place_id;
  if not found or not public.is_member_of(pl.circle_id) then
    raise exception 'Place not found.';
  end if;

  -- The arrival check and the last-known-location fallback both rely on
  -- pings actually being accepted.
  if not public.is_sharing(auth.uid()) then
    raise exception 'Turn on location sharing first so your circle can see you arrive.';
  end if;

  -- Starting a new walk ends any earlier one you left open.
  for old_id in
    select id from public.walks
    where user_id = auth.uid() and status in ('active', 'overdue')
  loop
    perform public.close_walk(old_id, 'safe');
  end loop;

  insert into public.walks (
    user_id, circle_id, place_id, place_name,
    dest_latitude, dest_longitude, arrive_radius_meters, expected_by
  )
  values (
    auth.uid(), pl.circle_id, pl.id, pl.name,
    pl.latitude, pl.longitude, greatest(pl.radius_meters, 50),
    now() + make_interval(mins => p_minutes)
  )
  returning id into new_id;

  select full_name into walker_name from public.profiles where id = auth.uid();
  perform public.send_alert_push(
    public.routine_recipients(pl.circle_id, auth.uid()),
    '🚶 ' || walker_name || ' is walking to ' || pl.name,
    'Due within ' || p_minutes || ' min. You''ll be alerted if they don''t arrive.',
    jsonb_build_object('type', 'walk', 'walkId', new_id, 'circleId', pl.circle_id)
  );

  return new_id;
end;
$$;

create or replace function public.end_walk(p_walk_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.walks;
  walker_name text;
begin
  select * into w from public.walks where id = p_walk_id and user_id = auth.uid();
  if not found then
    raise exception 'Walk not found.';
  end if;

  if public.close_walk(w.id, 'safe') then
    select full_name into walker_name from public.profiles where id = w.user_id;
    perform public.send_alert_push(
      -- An overdue walk already alerted everyone, so the all-clear does too.
      case when w.status = 'overdue'
        then public.circle_recipients(w.circle_id, w.user_id)
        else public.routine_recipients(w.circle_id, w.user_id)
      end,
      '✅ ' || walker_name || ' is safe',
      'They ended their walk to ' || w.place_name || '.',
      jsonb_build_object('type', 'walk', 'walkId', w.id, 'circleId', w.circle_id)
    );
  end if;
end;
$$;

create or replace function public.check_walk_arrival()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.walks;
  walker_name text;
begin
  select * into w
  from public.walks
  where user_id = new.user_id and status in ('active', 'overdue');

  if not found then
    return new;
  end if;
  if new.recorded_at < w.created_at or new.recorded_at < now() - interval '10 minutes' then
    return new;
  end if;
  if public.haversine_meters(new.latitude, new.longitude, w.dest_latitude, w.dest_longitude)
       > w.arrive_radius_meters then
    return new;
  end if;

  if public.close_walk(w.id, 'arrived') then
    select full_name into walker_name from public.profiles where id = w.user_id;
    perform public.send_alert_push(
      case when w.status = 'overdue'
        then public.circle_recipients(w.circle_id, w.user_id)
        else public.routine_recipients(w.circle_id, w.user_id)
      end,
      '✅ ' || walker_name || ' arrived safely',
      'Made it to ' || w.place_name || '.',
      jsonb_build_object('type', 'walk', 'walkId', w.id, 'circleId', w.circle_id)
    );
  end if;

  return new;
end;
$$;

-- ===== Check on me =====

create or replace function public.start_safety_timer(p_circle_id uuid, p_label text, p_minutes int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  who_name text;
  new_id uuid;
  old_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_member_of(p_circle_id) then
    raise exception 'Not a member of this circle.';
  end if;
  if p_label is not null and length(p_label) > 60 then
    raise exception 'Keep the note under 60 characters.';
  end if;
  if p_minutes is null or p_minutes < 5 or p_minutes > 480 then
    raise exception 'Choose between 5 minutes and 8 hours.';
  end if;

  -- Starting a new timer ends any earlier one left open, same as start_walk.
  select id into old_id from public.safety_timers where user_id = auth.uid() and status = 'active';
  if old_id is not null then
    update public.safety_timers set status = 'safe', ended_at = now() where id = old_id;
  end if;

  insert into public.safety_timers (user_id, circle_id, label, expected_by)
  values (auth.uid(), p_circle_id, nullif(trim(p_label), ''), now() + make_interval(mins => p_minutes))
  returning id into new_id;

  select full_name into who_name from public.profiles where id = auth.uid();
  perform public.send_alert_push(
    public.routine_recipients(p_circle_id, auth.uid()),
    '⏱️ ' || who_name || ' asked to be checked on',
    coalesce(nullif(trim(p_label), ''), 'No note') || ' — due in ' || p_minutes || ' min.',
    jsonb_build_object('type', 'safety_timer', 'timerId', new_id, 'circleId', p_circle_id)
  );

  return new_id;
end;
$$;

create or replace function public.end_safety_timer(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.safety_timers;
  who_name text;
begin
  select * into t from public.safety_timers where id = p_id and user_id = auth.uid();
  if not found then
    raise exception 'Timer not found.';
  end if;
  if t.status = 'safe' then
    return;
  end if;

  update public.safety_timers set status = 'safe', ended_at = now() where id = t.id;
  if t.sos_event_id is not null then
    update public.sos_events
    set resolved_at = now(), resolved_by = t.user_id
    where id = t.sos_event_id and resolved_at is null;
  end if;

  select full_name into who_name from public.profiles where id = t.user_id;
  perform public.send_alert_push(
    -- An overdue timer already alerted everyone, so the all-clear does too.
    case when t.status = 'overdue'
      then public.circle_recipients(t.circle_id, t.user_id)
      else public.routine_recipients(t.circle_id, t.user_id)
    end,
    '✅ ' || who_name || ' checked in',
    'They''re safe.',
    jsonb_build_object('type', 'safety_timer', 'timerId', t.id, 'circleId', t.circle_id)
  );
end;
$$;

-- ===== Meetup pins =====

create or replace function public.drop_pin(
  p_circle_id uuid,
  p_emoji text,
  p_label text,
  p_latitude double precision,
  p_longitude double precision,
  p_minutes int default 240
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  dropper_name text;
  pin_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_member_of(p_circle_id) then
    raise exception 'Not a member of this circle.';
  end if;
  if p_label is null or length(trim(p_label)) = 0 then
    raise exception 'Give the pin a label.';
  end if;
  if length(p_label) > 40 then
    raise exception 'Keep the label under 40 characters.';
  end if;
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'Invalid location.';
  end if;
  if p_minutes is null or p_minutes < 5 or p_minutes > 1440 then
    raise exception 'Choose between 5 minutes and 24 hours.';
  end if;

  insert into public.map_pins (circle_id, created_by, emoji, label, latitude, longitude, expires_at)
  values (
    p_circle_id, auth.uid(), coalesce(nullif(trim(p_emoji), ''), '📍'), trim(p_label),
    p_latitude, p_longitude, now() + make_interval(mins => p_minutes)
  )
  returning id into pin_id;

  select full_name into dropper_name from public.profiles where id = auth.uid();
  perform public.send_alert_push(
    public.routine_recipients(p_circle_id, auth.uid()),
    coalesce(nullif(trim(p_emoji), ''), '📍') || ' ' || dropper_name || ' dropped a pin',
    trim(p_label),
    jsonb_build_object('type', 'pin', 'pinId', pin_id, 'circleId', p_circle_id)
  );

  return pin_id;
end;
$$;

-- create or replace keeps each function's existing grants (authenticated can
-- call the user-facing ones; the trigger function is not an API entry point).
