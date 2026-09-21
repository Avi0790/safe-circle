-- "Need a ride": one tap alerts the circle-mates who are actually in a
-- position to help — currently driving and within a few miles of you —
-- instead of pinging a group chat and hoping. Built from data the app
-- already collects: each person's latest fix, and its ground speed (the
-- same signal behind the "🚗 Driving" status).
create table public.ride_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  status text not null default 'open' check (status in ('open', 'accepted', 'cancelled')),
  accepted_by uuid references public.profiles (id) on delete set null,
  -- How many people the request went to, so the requester can be told
  -- "nobody's driving nearby" and offered to ask the whole circle.
  notified_count int not null default 0,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create index ride_requests_user_idx on public.ride_requests (user_id, created_at desc);

alter table public.ride_requests enable row level security;

-- Visible to you and anyone you share a circle with (same rule as SOS).
-- Writes only through the functions below.
create policy "ride_requests_select"
  on public.ride_requests for select
  using (user_id = auth.uid() or public.shares_circle_with(user_id));

alter publication supabase_realtime add table public.ride_requests;

-- 15 mph, the same driving threshold the clients use (m/s).
-- Recipients when not asking everyone: fix under 3 min old, moving at
-- driving speed, within ~6 miles.
create function public.request_ride(
  p_latitude double precision,
  p_longitude double precision,
  p_everyone boolean default false
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  requester_name text;
  req_id uuid;
  r record;
  dist double precision;
  notified int := 0;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'Invalid location.';
  end if;

  -- Same idea as the SOS rate limit: count committed rows, no counter state.
  if (select count(*) from public.ride_requests
      where user_id = auth.uid() and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'Too many ride requests. Wait a few minutes.';
  end if;

  -- A new request replaces any earlier open one.
  update public.ride_requests set status = 'cancelled'
  where user_id = auth.uid() and status = 'open';

  select full_name into requester_name from public.profiles where id = auth.uid();

  insert into public.ride_requests (user_id, latitude, longitude)
  values (auth.uid(), p_latitude, p_longitude)
  returning id into req_id;

  for r in
    select distinct on (cm2.user_id)
      cm2.user_id as uid, ll.latitude, ll.longitude, ll.speed, ll.recorded_at
    from public.circle_members cm1
    join public.circle_members cm2
      on cm2.circle_id = cm1.circle_id and cm2.user_id <> cm1.user_id
    left join lateral (
      select l.latitude, l.longitude, l.speed, l.recorded_at
      from public.locations l
      where l.user_id = cm2.user_id
      order by l.recorded_at desc
      limit 1
    ) ll on true
    where cm1.user_id = auth.uid()
  loop
    dist := case
      when r.latitude is not null and r.recorded_at > now() - interval '10 minutes'
        then public.haversine_meters(p_latitude, p_longitude, r.latitude, r.longitude)
      else null
    end;

    if not p_everyone then
      -- Must be driving right now, recently reported, and close by.
      if r.recorded_at is null
         or r.recorded_at < now() - interval '3 minutes'
         or coalesce(r.speed, 0) < 6.7
         or dist is null
         or dist > 10000 then
        continue;
      end if;
    end if;

    perform public.send_alert_push(
      array[r.uid],
      '🚗 ' || requester_name || ' needs a ride',
      case when dist is not null
        then 'About ' || round((dist / 1609.34)::numeric, 1) || ' mi from you. Open Safe Circle to help.'
        else 'Open Safe Circle to help.'
      end,
      jsonb_build_object('type', 'ride', 'requestId', req_id)
    );
    notified := notified + 1;
  end loop;

  update public.ride_requests set notified_count = notified where id = req_id;
  return notified;
end;
$$;

-- First person to say "I'll go" wins; everyone else gets a clear message
-- instead of two drivers showing up.
create function public.accept_ride(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  requester uuid;
  driver_name text;
begin
  update public.ride_requests
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = p_request_id
    and status = 'open'
    and user_id <> auth.uid()
    and created_at > now() - interval '30 minutes'
    and public.shares_circle_with(user_id)
  returning user_id into requester;

  if not found then
    raise exception 'This ride request was already taken or has expired.';
  end if;

  select full_name into driver_name from public.profiles where id = auth.uid();
  perform public.send_alert_push(
    array[requester],
    '🚗 ' || driver_name || ' is on the way',
    'They accepted your ride request.',
    jsonb_build_object('type', 'ride', 'requestId', p_request_id)
  );
end;
$$;

-- Cancel an open request, or mark an accepted one done ("got my ride").
create function public.cancel_ride(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ride_requests
  set status = 'cancelled'
  where id = p_request_id and user_id = auth.uid() and status in ('open', 'accepted');
end;
$$;

revoke all on function public.request_ride(double precision, double precision, boolean) from public, anon;
revoke all on function public.accept_ride(uuid) from public, anon;
revoke all on function public.cancel_ride(uuid) from public, anon;
grant execute on function public.request_ride(double precision, double precision, boolean) to authenticated;
grant execute on function public.accept_ride(uuid) to authenticated;
grant execute on function public.cancel_ride(uuid) to authenticated;
