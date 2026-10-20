-- Share ETA with anyone, like Apple Maps: while navigating, send a link to
-- someone who doesn't have Safe Circle. They see where you're headed, your
-- ETA (kept current by your phone) and your live position, in any browser.
--
-- It's a guest link (migration ...000043) that also carries the trip. When
-- you arrive the page says so and stops showing where you are; if you stop
-- navigating, the link ends there and then. A trip link expires on its own
-- 30 minutes after the ETA, so a forgotten one doesn't keep showing you.
alter table public.share_links
  add column trip_destination text check (trip_destination is null or char_length(trip_destination) between 1 and 80),
  add column trip_eta timestamptz,
  add column trip_mode text check (trip_mode is null or trip_mode in ('drive', 'walk', 'bus', 'train', 'flight')),
  add column trip_status text check (trip_status is null or trip_status in ('active', 'arrived')),
  add column trip_updated_at timestamptz;

-- Returns the new link's id (for updates) and its token (shown once; only the
-- hash is stored, as for every guest link).
create function public.create_trip_share_link(p_destination text, p_eta timestamptz, p_mode text default 'drive')
returns table (id uuid, token text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  dest text := trim(p_destination);
  new_token text;
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if dest is null or char_length(dest) < 1 or char_length(dest) > 80 then
    raise exception 'Give the destination a name of 1 to 80 characters.';
  end if;
  if p_mode is null or p_mode not in ('drive', 'walk', 'bus', 'train', 'flight') then
    raise exception 'Choose driving, walking, bus, train or flight.';
  end if;
  if p_eta is null or p_eta < now() - interval '1 minute' or p_eta > now() + interval '24 hours' then
    raise exception 'The arrival time must be within the next 24 hours.';
  end if;
  if (select count(*) from public.share_links
      where user_id = auth.uid() and revoked_at is null and expires_at > now()) >= 5 then
    raise exception 'You already have 5 active links. Revoke one first.';
  end if;

  new_token := encode(gen_random_bytes(24), 'hex');
  insert into public.share_links (
    user_id, token_hash, expires_at,
    trip_destination, trip_eta, trip_mode, trip_status, trip_updated_at
  )
  values (
    auth.uid(), encode(digest(new_token, 'sha256'), 'hex'), greatest(p_eta, now()) + interval '30 minutes',
    dest, p_eta, p_mode, 'active', now()
  )
  returning share_links.id into new_id;

  return query select new_id, new_token;
end;
$$;

-- A fresher ETA from the phone; the link's end moves with it. At most every
-- 15 seconds, like shared trips.
create function public.update_trip_share_link(p_id uuid, p_eta timestamptz)
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
  update public.share_links
  set trip_eta = p_eta,
      expires_at = greatest(p_eta, now()) + interval '30 minutes',
      trip_updated_at = now()
  where id = p_id and user_id = auth.uid() and revoked_at is null and expires_at > now()
    and trip_status = 'active'
    and trip_updated_at <= now() - interval '15 seconds';
end;
$$;

-- Arrived: the page shows "arrived" for 15 minutes, without your location.
-- Not arrived (you stopped navigating): the link ends now.
create function public.finish_trip_share_link(p_id uuid, p_arrived boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_arrived then
    update public.share_links
    set trip_status = 'arrived', trip_updated_at = now(),
        expires_at = least(expires_at, now() + interval '15 minutes')
    where id = p_id and user_id = auth.uid() and revoked_at is null and trip_status = 'active';
  else
    update public.share_links
    set revoked_at = now()
    where id = p_id and user_id = auth.uid() and revoked_at is null and trip_status is not null;
  end if;
end;
$$;

-- The public read, now with the trip. Its result columns change, so it has
-- to be dropped and recreated (and re-granted). Once the trip has arrived the
-- location columns come back empty: the person who got the link learns you
-- got there, not where you go next.
drop function public.get_shared_location(text);

create function public.get_shared_location(p_token text)
returns table (
  first_name text,
  latitude double precision,
  longitude double precision,
  accuracy double precision,
  speed real,
  battery_level real,
  recorded_at timestamptz,
  expires_at timestamptz,
  trip_destination text,
  trip_eta timestamptz,
  trip_mode text,
  trip_status text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  link public.share_links;
begin
  select * into link
  from public.share_links
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and revoked_at is null
    and share_links.expires_at > now();
  if link.id is null then
    return;
  end if;

  if link.last_viewed_at is null or link.last_viewed_at < now() - interval '5 minutes' then
    update public.share_links
    set view_count = view_count + 1, last_viewed_at = now()
    where id = link.id;
  end if;

  return query
  select split_part(p.full_name, ' ', 1),
         case when link.trip_status = 'arrived' then null else l.latitude end,
         case when link.trip_status = 'arrived' then null else l.longitude end,
         case when link.trip_status = 'arrived' then null else l.accuracy::double precision end,
         case when link.trip_status = 'arrived' then null else l.speed end,
         case when link.trip_status = 'arrived' then null else l.battery_level::real end,
         case when link.trip_status = 'arrived' then null else l.recorded_at end,
         link.expires_at,
         link.trip_destination, link.trip_eta, link.trip_mode, link.trip_status
  from public.profiles p
  left join lateral (
    select * from public.locations where user_id = p.id order by recorded_at desc limit 1
  ) l on true
  where p.id = link.user_id;
end;
$$;

revoke all on function public.get_shared_location(text) from public;
grant execute on function public.get_shared_location(text) to anon, authenticated;

revoke all on function public.create_trip_share_link(text, timestamptz, text) from public, anon;
revoke all on function public.update_trip_share_link(uuid, timestamptz) from public, anon;
revoke all on function public.finish_trip_share_link(uuid, boolean) from public, anon;
grant execute on function public.create_trip_share_link(text, timestamptz, text) to authenticated;
grant execute on function public.update_trip_share_link(uuid, timestamptz) to authenticated;
grant execute on function public.finish_trip_share_link(uuid, boolean) to authenticated;
