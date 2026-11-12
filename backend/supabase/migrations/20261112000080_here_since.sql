-- "Here since 9:21 AM" on the person card (mobile/components/MemberCard.tsx):
-- when someone arrived at the spot they're at now. Worked out from their
-- last day of positions: the earliest point after the last time they were
-- more than 150 m from where they are now.
--
-- security invoker: it reads locations as the caller, so it sees only the
-- rows the caller could already read (a circle-mate who is sharing, not
-- hidden by ghost mode, within their sharing window), and returns one time,
-- never a position.
create function public.here_since(p_user uuid)
returns timestamptz
language sql
stable
security invoker
set search_path = public
as $$
  with recent as (
    select latitude, longitude, recorded_at
    from public.locations
    where user_id = p_user and recorded_at > now() - interval '24 hours'
  ),
  latest as (
    select latitude, longitude from recent order by recorded_at desc limit 1
  ),
  last_away as (
    select max(r.recorded_at) as at
    from recent r, latest l
    where 111320 * sqrt(
            power(r.latitude - l.latitude, 2)
            + power((r.longitude - l.longitude) * cos(radians(l.latitude)), 2)
          ) > 150
  )
  select min(r.recorded_at)
  from recent r
  where r.recorded_at > coalesce((select at from last_away), '-infinity'::timestamptz);
$$;
revoke all on function public.here_since(uuid) from public, anon;
grant execute on function public.here_since(uuid) to authenticated;
