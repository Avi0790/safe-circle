-- "Check in" (Life360-style): a chat message that carries where you are, so
-- the circle gets "📍 Alex checked in" with a map link instead of having to
-- open the map. Nullable — ordinary messages have no location. No policy
-- change: inserts are still "circle member, as yourself", and reads are still
-- circle members only, so this exposes nothing they couldn't see already.
alter table public.messages
  add column latitude double precision,
  add column longitude double precision;
