-- Drive reports: real trips (start, end, duration, distance, top speed),
-- not just a live "🚗 Driving NN mph" status — Life360's Driver Reports,
-- built entirely from location data this app already collects, on either
-- the driver's own account or (for a parent checking a teen) anyone they
-- share a circle with.
--
-- A trip is a maximal run of one user's location pings where:
--   * consecutive pings are no more than 15 minutes apart (a bigger gap
--     means tracking stopped — phone locked, sharing paused — not that the
--     same drive continued), and
--   * the run contains at least one ping at or above driving speed
--     (6.7 m/s / 15 mph, the same threshold isDriving() already uses).
-- Slowing down at a light or in traffic doesn't split a trip — only an
-- actual gap in pings does, and pings keep arriving on the usual ~60s
-- throttle regardless of speed. This is the same "rough vehicle signal,
-- not real trip detection" caveat that already applies to the live driving
-- status (see mobile/lib/format.ts's isDriving), just applied to history
-- instead of one fix at a time.
create function public.get_trips(p_user_id uuid, p_days int default 30, p_limit int default 20)
returns table (
  trip_id bigint,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds int,
  distance_meters double precision,
  max_speed_mps real,
  avg_speed_mps double precision,
  start_latitude double precision,
  start_longitude double precision,
  end_latitude double precision,
  end_longitude double precision
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  -- Mirrors locations_select_self_or_circlemate exactly (migration
  -- ...000038_ghost_mode_fix.sql) rather than inventing a separate rule:
  -- this function reads from `locations` as security definer (bypassing
  -- its RLS), so it has to re-apply the same visibility check by hand —
  -- share a circle, still sharing, and not hidden from the caller — or a
  -- stopped-sharing or ghost-mode target's past trips would leak through
  -- a door the live map and history screen don't have.
  if p_user_id <> auth.uid()
     and not (
       public.shares_circle_with(p_user_id)
       and public.is_sharing(p_user_id)
       and not public.is_hidden_by(p_user_id)
     )
  then
    return;
  end if;
  if p_days is null or p_days < 1 or p_days > 365 then
    p_days := 30;
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    p_limit := 20;
  end if;

  return query
  with pings as (
    select
      l.latitude, l.longitude, l.speed, l.recorded_at,
      l.recorded_at - lag(l.recorded_at) over (order by l.recorded_at) as gap
    from public.locations l
    where l.user_id = p_user_id
      and l.recorded_at > now() - make_interval(days => p_days)
  ),
  sessioned as (
    select *,
      sum(case when gap is null or gap > interval '15 minutes' then 1 else 0 end)
        over (order by recorded_at) as session_id
    from pings
  ),
  driving_sessions as (
    select distinct session_id from sessioned where coalesce(speed, 0) >= 6.7
  ),
  trip_pings as (
    select s.*,
      public.haversine_meters(
        lag(s.latitude) over (partition by s.session_id order by s.recorded_at),
        lag(s.longitude) over (partition by s.session_id order by s.recorded_at),
        s.latitude, s.longitude
      ) as segment_meters
    from sessioned s
    join driving_sessions d on d.session_id = s.session_id
  )
  select
    session_id,
    min(recorded_at),
    max(recorded_at),
    extract(epoch from max(recorded_at) - min(recorded_at))::int,
    sum(coalesce(segment_meters, 0)),
    max(speed),
    avg(speed) filter (where speed is not null),
    (array_agg(latitude order by recorded_at))[1],
    (array_agg(longitude order by recorded_at))[1],
    (array_agg(latitude order by recorded_at desc))[1],
    (array_agg(longitude order by recorded_at desc))[1]
  from trip_pings
  group by session_id
  order by min(recorded_at) desc
  limit p_limit;
end;
$$;

revoke all on function public.get_trips(uuid, int, int) from public, anon;
grant execute on function public.get_trips(uuid, int, int) to authenticated;
