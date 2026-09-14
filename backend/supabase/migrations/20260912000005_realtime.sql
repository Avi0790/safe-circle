-- Stream new location pings and membership changes to subscribed clients
-- (the phone app's live map and the read-only web dashboard).
alter publication supabase_realtime add table public.locations;
alter publication supabase_realtime add table public.circle_members;

-- Needed so realtime UPDATE/DELETE payloads include full old row data.
-- Locations are insert-only today but this keeps the table future-proof.
alter table public.locations replica identity full;
