-- place_membership_state (...000006_push_and_geofencing.sql) already has a
-- select RLS policy and is kept live-accurate by evaluate_geofences() on
-- every location insert, but was never added to the realtime publication —
-- so no client could show a live "who's actually at this place right now"
-- view (only the historical arrive/leave feed in geofence_events), even
-- though the data has existed since the backend layer was built.
alter publication supabase_realtime add table public.place_membership_state;
