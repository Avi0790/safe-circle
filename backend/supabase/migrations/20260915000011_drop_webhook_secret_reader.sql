-- One-time sync from vault to the Edge Function's env is done (see
-- migration ...000009's comment). Drop the temporary accessor so the
-- window it existed in is closed entirely, not just access-revoked.
drop function if exists public._read_geofence_webhook_secret();
