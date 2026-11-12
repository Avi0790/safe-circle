-- "Notify me when they arrive" (mobile/components/MemberCard.tsx): from
-- someone's card, ask to be told once when they reach one of the circle's
-- places, or when they leave the spot they're at now. Each watch fires once
-- (or lapses after 24 hours), from a check on every new location.
--
-- Only about someone whose location you can already see: you share a circle,
-- they're sharing right now, and they haven't hidden from you (ghost mode).
-- The same holds when it fires, so hiding or stopping sharing afterwards
-- silences it. A watch tells the watcher nothing the map wouldn't.

create table public.arrival_watches (
  id uuid primary key default gen_random_uuid(),
  watcher_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  target_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('arrive', 'leave')),
  place_id uuid references public.places (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  latitude double precision not null,
  longitude double precision not null,
  radius_meters double precision not null check (radius_meters between 25 and 2000),
  created_at timestamptz not null default now(),
  fired_at timestamptz,
  check (watcher_id <> target_id)
);
create index arrival_watches_target_idx on public.arrival_watches (target_id) where fired_at is null;
create index arrival_watches_watcher_idx on public.arrival_watches (watcher_id, created_at desc);

alter table public.arrival_watches enable row level security;
create policy "arrival_watches_select_own" on public.arrival_watches
  for select to authenticated using (watcher_id = auth.uid());
-- Writes go through the functions below.

-- Can p_viewer see p_target's location right now? The map's rule, for any viewer.
create function public.can_follow_location(p_viewer uuid, p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_viewer <> p_target
    and public.is_sharing(p_target)
    and exists (
      select 1 from public.circle_members a
      join public.circle_members b on b.circle_id = a.circle_id
      where a.user_id = p_viewer and b.user_id = p_target
    )
    and not exists (
      select 1 from public.hidden_from h where h.owner_id = p_target and h.hidden_from_id = p_viewer
    );
$$;
revoke all on function public.can_follow_location(uuid, uuid) from public, anon, authenticated;

-- Metres between two points (flat-earth, accurate at these distances).
create function public.metres_between(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql
immutable
as $$
  select 111320 * sqrt(power(lat1 - lat2, 2) + power((lng1 - lng2) * cos(radians(lat2)), 2));
$$;

create function public.create_arrival_watch(
  p_target uuid,
  p_kind text,
  p_place uuid default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_label text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  pl public.places;
  lat double precision;
  lng double precision;
  rad double precision := 150;
  lab text := nullif(trim(coalesce(p_label, '')), '');
  now_at record;
  new_id uuid;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  if p_kind not in ('arrive', 'leave') then
    raise exception 'Choose arrive or leave.';
  end if;
  if not public.can_follow_location(me, p_target) then
    raise exception 'You can only be notified about someone sharing their location with you.';
  end if;

  if p_place is not null then
    select * into pl from public.places where id = p_place;
    if pl.id is null or not exists (
      select 1 from public.circle_members a
      join public.circle_members b on b.circle_id = a.circle_id
      where a.circle_id = pl.circle_id and a.user_id = me and b.user_id = p_target
    ) then
      raise exception 'Place not found.';
    end if;
    lat := pl.latitude; lng := pl.longitude; rad := pl.radius_meters; lab := pl.name;
  else
    if p_latitude is null or p_longitude is null or lab is null
       or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
      raise exception 'Choose a place.';
    end if;
    lat := p_latitude; lng := p_longitude;
  end if;
  if char_length(lab) > 80 then
    lab := left(lab, 80);
  end if;

  -- where they are now decides whether the watch makes sense
  select l.latitude, l.longitude into now_at
  from public.locations l where l.user_id = p_target order by l.recorded_at desc limit 1;
  if now_at.latitude is not null then
    if p_kind = 'arrive' and public.metres_between(now_at.latitude, now_at.longitude, lat, lng) <= rad then
      raise exception 'They''re already there.';
    end if;
    if p_kind = 'leave' and public.metres_between(now_at.latitude, now_at.longitude, lat, lng) > rad then
      raise exception 'They''re not there now.';
    end if;
  end if;

  -- one of each kind per person and place; a new one replaces the old
  delete from public.arrival_watches
  where watcher_id = me and target_id = p_target and kind = p_kind and label = lab and fired_at is null;
  if (select count(*) from public.arrival_watches
      where watcher_id = me and fired_at is null and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'You have 10 alerts set already.';
  end if;

  insert into public.arrival_watches (watcher_id, target_id, kind, place_id, label, latitude, longitude, radius_meters)
  values (me, p_target, p_kind, pl.id, lab, lat, lng, rad)
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.create_arrival_watch(uuid, text, uuid, double precision, double precision, text) from public, anon;
grant execute on function public.create_arrival_watch(uuid, text, uuid, double precision, double precision, text) to authenticated;

create function public.cancel_arrival_watch(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.arrival_watches where id = p_id and watcher_id = auth.uid();
$$;
revoke all on function public.cancel_arrival_watch(uuid) from public, anon;
grant execute on function public.cancel_arrival_watch(uuid) to authenticated;

-- On every new location: fire the watches it satisfies.
create function public.fire_arrival_watches()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  w record;
  who text;
  dist double precision;
begin
  for w in
    select * from public.arrival_watches
    where target_id = new.user_id and fired_at is null and created_at > now() - interval '24 hours'
    for update skip locked
  loop
    dist := public.metres_between(new.latitude, new.longitude, w.latitude, w.longitude);
    continue when (w.kind = 'arrive' and dist > w.radius_meters) or (w.kind = 'leave' and dist <= w.radius_meters);
    update public.arrival_watches set fired_at = now() where id = w.id;
    continue when not public.can_follow_location(w.watcher_id, new.user_id);
    if who is null then
      select full_name into who from public.profiles where id = new.user_id;
      who := coalesce(who, 'Someone');
    end if;
    perform public.send_alert_push(
      array[w.watcher_id],
      case w.kind when 'arrive' then '📍 ' || who || ' arrived at ' || w.label
                  else '🚶 ' || who || ' left ' || w.label end,
      'Open Safe Circle to see where they are.',
      jsonb_build_object('type', 'arrival_watch', 'userId', new.user_id)
    );
  end loop;
  return null;
end;
$$;
revoke all on function public.fire_arrival_watches() from public, anon, authenticated;

create trigger locations_fire_arrival_watches
  after insert on public.locations
  for each row execute function public.fire_arrival_watches();

-- Watches you set are part of "Download my data".
alter function public.export_my_data() rename to export_my_data_through_077;
revoke all on function public.export_my_data_through_077() from public, anon, authenticated;

create function public.export_my_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  return public.export_my_data_through_077() || jsonb_build_object(
    'arrival_alerts_you_set', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'about', p.full_name, 'kind', w.kind, 'place', w.label,
        'set_at', w.created_at, 'fired_at', w.fired_at
      ) order by w.created_at desc), '[]'::jsonb)
      from public.arrival_watches w join public.profiles p on p.id = w.target_id
      where w.watcher_id = auth.uid()
    )
  );
end;
$$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
