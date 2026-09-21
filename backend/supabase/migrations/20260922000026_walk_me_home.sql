-- Walk me home: pick a saved place and a time limit. Your circle sees you're
-- on your way and gets told when you arrive. If you neither arrive nor tap
-- "I'm safe" before the timer runs out, an SOS goes out automatically with
-- your last known location — protection for the moment you can't press SOS
-- yourself, which is what a manual SOS button can't offer.
create table public.walks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  circle_id uuid not null references public.circles (id) on delete cascade,
  place_id uuid references public.places (id) on delete set null,
  -- Snapshotted so a walk still reads correctly if the place is later
  -- renamed, moved, or deleted mid-walk.
  place_name text not null,
  dest_latitude double precision not null,
  dest_longitude double precision not null,
  arrive_radius_meters double precision not null,
  expected_by timestamptz not null,
  -- active  -> timer running
  -- arrived -> reached the destination
  -- safe    -> person ended it themselves ("I'm safe")
  -- overdue -> timer ran out, SOS sent; still open until they arrive or check in
  status text not null default 'active'
    check (status in ('active', 'arrived', 'safe', 'overdue')),
  sos_event_id bigint references public.sos_events (id) on delete set null,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

-- One unfinished walk per person; also the lookup the arrival trigger runs
-- on every location ping.
create unique index walks_one_open_per_user
  on public.walks (user_id) where status in ('active', 'overdue');
create index walks_expiry_idx
  on public.walks (expected_by) where status = 'active';

alter table public.walks enable row level security;

-- Readable by the walker and their circle. Writes happen only through the
-- functions below (no insert/update/delete policies), so the timer, status
-- and SOS link can't be tampered with from a client.
create policy "walks_select"
  on public.walks for select
  using (user_id = auth.uid() or public.is_member_of(circle_id));

alter publication supabase_realtime add table public.walks;

-- Internal: everyone in a circle except one person.
create function public.circle_recipients(p_circle_id uuid, p_except uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(user_id), '{}'::uuid[])
  from public.circle_members
  where circle_id = p_circle_id and user_id <> p_except;
$$;

-- Internal: finish a walk and clear the automatic SOS it may have raised.
-- Returns false if it was already finished, so callers notify only once.
create function public.close_walk(p_walk_id uuid, p_status text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.walks;
begin
  update public.walks
  set status = p_status, ended_at = now()
  where id = p_walk_id and status in ('active', 'overdue')
  returning * into w;

  if not found then
    return false;
  end if;

  if w.sos_event_id is not null then
    update public.sos_events
    set resolved_at = now(), resolved_by = w.user_id
    where id = w.sos_event_id and resolved_at is null;
  end if;

  return true;
end;
$$;

create function public.start_walk(p_place_id uuid, p_minutes int)
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
    public.circle_recipients(pl.circle_id, auth.uid()),
    '🚶 ' || walker_name || ' is walking to ' || pl.name,
    'Due within ' || p_minutes || ' min. You''ll be alerted if they don''t arrive.',
    jsonb_build_object('type', 'walk', 'walkId', new_id, 'circleId', pl.circle_id)
  );

  return new_id;
end;
$$;

-- "I'm safe": ends the walk early (and cancels an SOS it already raised).
create function public.end_walk(p_walk_id uuid)
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
      public.circle_recipients(w.circle_id, w.user_id),
      '✅ ' || walker_name || ' is safe',
      'They ended their walk to ' || w.place_name || '.',
      jsonb_build_object('type', 'walk', 'walkId', w.id, 'circleId', w.circle_id)
    );
  end if;
end;
$$;

-- Not there yet? Push the deadline back (at most an hour at a time, and no
-- more than six hours past when the walk started).
create function public.extend_walk(p_walk_id uuid, p_minutes int)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  new_deadline timestamptz;
begin
  if p_minutes is null or p_minutes < 1 or p_minutes > 60 then
    raise exception 'Extend by 1 to 60 minutes.';
  end if;

  update public.walks
  set expected_by = expected_by + make_interval(mins => p_minutes)
  where id = p_walk_id
    and user_id = auth.uid()
    and status = 'active'
    and expected_by + make_interval(mins => p_minutes) <= created_at + interval '6 hours'
  returning expected_by into new_deadline;

  if not found then
    raise exception 'This walk can''t be extended.';
  end if;
  return new_deadline;
end;
$$;

-- Arrival detection, on every location ping. Ignores stale pings (queued
-- while offline) so an old fix from before the walk can't "arrive" it.
create function public.check_walk_arrival()
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
      public.circle_recipients(w.circle_id, w.user_id),
      '✅ ' || walker_name || ' arrived safely',
      'Made it to ' || w.place_name || '.',
      jsonb_build_object('type', 'walk', 'walkId', w.id, 'circleId', w.circle_id)
    );
  end if;

  return new;
end;
$$;

create trigger locations_check_walk_arrival
  after insert on public.locations
  for each row execute function public.check_walk_arrival();

-- The timer. Run every minute by pg_cron: any walk past its deadline
-- becomes "overdue" and raises a normal SOS (so it appears on everyone's
-- SOS banner and goes out through the existing SOS push) at the person's
-- last known location.
create function public.expire_walks()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.walks;
  loc record;
  sos_id bigint;
  n int := 0;
begin
  for w in
    select * from public.walks
    where status = 'active' and expected_by < now()
    for update skip locked
  loop
    select latitude, longitude into loc
    from public.locations
    where user_id = w.user_id
    order by recorded_at desc
    limit 1;

    sos_id := null;
    begin
      insert into public.sos_events (user_id, latitude, longitude, message)
      values (
        w.user_id,
        coalesce(loc.latitude, w.dest_latitude),
        coalesce(loc.longitude, w.dest_longitude),
        'Automatic alert: didn''t arrive at ' || w.place_name
          || ' before their walk timer ran out. This is their last known location.'
      )
      returning id into sos_id;
    exception when others then
      -- e.g. the SOS rate limit: they already have alerts out. Still mark
      -- the walk overdue so this row doesn't fail every minute forever.
      sos_id := null;
    end;

    update public.walks set status = 'overdue', sos_event_id = sos_id where id = w.id;

    perform public.send_alert_push(
      array[w.user_id],
      '⏰ Your walk timer ran out',
      'Your circle was alerted. Open Safe Circle and tap "I''m safe" if you''re okay.',
      jsonb_build_object('type', 'walk', 'walkId', w.id, 'circleId', w.circle_id)
    );
    n := n + 1;
  end loop;

  return n;
end;
$$;

-- These run as the owner and can push to anyone / raise SOS alerts, so
-- clients must not be able to call them through /rpc. Only the walk
-- functions a person legitimately uses are granted.
revoke all on function public.circle_recipients(uuid, uuid) from public, anon, authenticated;
revoke all on function public.close_walk(uuid, text) from public, anon, authenticated;
revoke all on function public.expire_walks() from public, anon, authenticated;
revoke all on function public.start_walk(uuid, int) from public, anon;
revoke all on function public.end_walk(uuid) from public, anon;
revoke all on function public.extend_walk(uuid, int) from public, anon;
grant execute on function public.start_walk(uuid, int) to authenticated;
grant execute on function public.end_walk(uuid) to authenticated;
grant execute on function public.extend_walk(uuid, int) to authenticated;

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule('expire-walks', '* * * * *', 'select public.expire_walks()');
