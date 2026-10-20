-- Share ETA with anyone from a bus, train or flight trip (Share a trip
-- screen). Those trips last hours and are managed from a screen you leave and
-- come back to, so a link sent for one is tied to the trip on the server:
-- whatever happens to the trip happens to its links.
--   running late (new ETA)  -> the links show the new ETA, and end later
--   I've arrived            -> the links say so, without your location
--   stop / a new trip / the trip expires -> the links end
--
-- Trip links also get the same limits as the trip they describe: a flight can
-- be up to 48 hours ahead, and a bus, train or flight link stays up for the
-- trip's grace period after its ETA (manual_trip_grace, ...000060) instead of
-- 30 minutes.
alter table public.share_links
  add column shared_trip_id uuid references public.shared_trips (id) on delete set null;
create index share_links_trip_idx on public.share_links (shared_trip_id) where shared_trip_id is not null;

-- When a trip link should end: the ETA plus the trip's grace for delays.
create function public.trip_link_expiry(p_eta timestamptz, p_mode text)
returns timestamptz
language sql
stable
as $$
  select greatest(p_eta, now()) + coalesce(public.manual_trip_grace(p_mode), interval '30 minutes')
$$;
revoke all on function public.trip_link_expiry(timestamptz, text) from public, anon, authenticated;

-- A new optional parameter (the trip to follow) would otherwise create an
-- overload alongside the old three-argument version.
drop function public.create_trip_share_link(text, timestamptz, text);

create function public.create_trip_share_link(
  p_destination text,
  p_eta timestamptz,
  p_mode text default 'drive',
  p_trip uuid default null
)
returns table (id uuid, token text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  dest text := trim(p_destination);
  eta timestamptz := p_eta;
  mode text := p_mode;
  trip public.shared_trips;
  new_token text;
  new_id uuid;
  max_ahead interval;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  -- Following one of your trips: the link describes that trip, whatever the
  -- other arguments say.
  if p_trip is not null then
    select * into trip from public.shared_trips
    where shared_trips.id = p_trip and user_id = auth.uid() and status = 'active';
    if not found then
      raise exception 'Trip not found.';
    end if;
    dest := trip.destination;
    eta := trip.eta;
    mode := trip.mode;
  end if;

  if dest is null or char_length(dest) < 1 or char_length(dest) > 80 then
    raise exception 'Give the destination a name of 1 to 80 characters.';
  end if;
  if mode is null or mode not in ('drive', 'walk', 'bus', 'train', 'flight') then
    raise exception 'Choose driving, walking, bus, train or flight.';
  end if;
  max_ahead := case when mode = 'flight' then interval '48 hours' else interval '24 hours' end;
  if eta is null or eta < now() - interval '1 minute' or eta > now() + max_ahead then
    raise exception 'The arrival time must be within the next % hours.', extract(epoch from max_ahead)::int / 3600;
  end if;
  if (select count(*) from public.share_links
      where user_id = auth.uid() and revoked_at is null and expires_at > now()) >= 5 then
    raise exception 'You already have 5 active links. Revoke one first.';
  end if;

  new_token := encode(gen_random_bytes(24), 'hex');
  insert into public.share_links (
    user_id, token_hash, expires_at,
    trip_destination, trip_eta, trip_mode, trip_status, trip_updated_at, shared_trip_id
  )
  values (
    auth.uid(), encode(digest(new_token, 'sha256'), 'hex'), public.trip_link_expiry(eta, mode),
    dest, eta, mode, 'active', now(), p_trip
  )
  returning share_links.id into new_id;

  return query select new_id, new_token;
end;
$$;

-- As before (...000062), with the trip's own limits.
create or replace function public.update_trip_share_link(p_id uuid, p_eta timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  link_mode text;
  max_ahead interval;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select trip_mode into link_mode from public.share_links where id = p_id and user_id = auth.uid();
  max_ahead := case when link_mode = 'flight' then interval '48 hours' else interval '24 hours' end;
  if p_eta is null or p_eta < now() - interval '1 minute' or p_eta > now() + max_ahead then
    raise exception 'The arrival time must be within the next % hours.', extract(epoch from max_ahead)::int / 3600;
  end if;
  update public.share_links
  set trip_eta = p_eta,
      expires_at = public.trip_link_expiry(p_eta, trip_mode),
      trip_updated_at = now()
  where id = p_id and user_id = auth.uid() and revoked_at is null and expires_at > now()
    and trip_status = 'active'
    and trip_updated_at <= now() - interval '15 seconds';
end;
$$;

-- Links follow their trip. One trigger covers every way a trip changes:
-- update_shared_trip, end_shared_trip, a new trip ending the old one, and the
-- expiry job.
create function public.sync_trip_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'active' and new.eta is distinct from old.eta then
    update public.share_links
    set trip_eta = new.eta, expires_at = public.trip_link_expiry(new.eta, new.mode), trip_updated_at = now()
    where shared_trip_id = new.id and revoked_at is null and trip_status = 'active';
  elsif old.status = 'active' and new.status = 'arrived' then
    update public.share_links
    set trip_status = 'arrived', trip_updated_at = now(),
        expires_at = least(expires_at, now() + interval '15 minutes')
    where shared_trip_id = new.id and revoked_at is null and trip_status = 'active';
  elsif old.status = 'active' and new.status in ('ended', 'stale') then
    update public.share_links
    set revoked_at = now()
    where shared_trip_id = new.id and revoked_at is null;
  end if;
  return new;
end;
$$;

create trigger shared_trips_sync_links
  after update of status, eta on public.shared_trips
  for each row execute function public.sync_trip_links();

revoke all on function public.create_trip_share_link(text, timestamptz, text, uuid) from public, anon;
grant execute on function public.create_trip_share_link(text, timestamptz, text, uuid) to authenticated;
