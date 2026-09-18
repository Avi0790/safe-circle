-- Driving/moving status (Life360-style) — expo-location's LocationObject
-- already reports ground speed (coords.speed, meters/second) on every fix;
-- it just wasn't being captured or stored. Nullable since it's not always
-- available (e.g. a stale/cached fix, or a platform that doesn't report it).
alter table public.locations add column speed real;

-- Recreate rather than alter: Postgres views don't support adding a column
-- to a `select distinct on (...) <columns>` view in place.
drop view public.latest_locations;

create view public.latest_locations
with (security_invoker = true) as
select distinct on (user_id)
  id, user_id, latitude, longitude, accuracy, battery_level, speed, recorded_at
from public.locations
order by user_id, recorded_at desc;
