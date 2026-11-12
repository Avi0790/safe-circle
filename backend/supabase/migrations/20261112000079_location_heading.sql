-- Which way someone is heading, for the direction beam on the map
-- (mobile/components/MemberPin.tsx). It's the GPS course: the direction of
-- travel in degrees clockwise from north, which phones report while moving
-- and leave out (or as -1) when still. Nullable for that reason, and for
-- every row sent before this. Readable by exactly who could already read the
-- position: no new policy.
alter table public.locations
  add column heading real check (heading is null or (heading >= 0 and heading < 360));

-- Appended at the end, so the view can be replaced in place (ghost mode and
-- the rest of its access rules come from locations' own policies through
-- security_invoker).
create or replace view public.latest_locations
with (security_invoker = true) as
select distinct on (user_id)
  id, user_id, latitude, longitude, accuracy, battery_level, speed, recorded_at, heading
from public.locations
order by user_id, recorded_at desc;
