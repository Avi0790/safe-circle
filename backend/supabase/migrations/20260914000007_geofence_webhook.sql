-- The Supabase Dashboard's "Database Webhooks" UI depends on an internal
-- `supabase_functions` schema that isn't provisioned on every project. Wire
-- the same behavior ourselves with pg_net instead: fire-and-forget an HTTP
-- call to the send-geofence-push Edge Function whenever a geofence_events
-- row is inserted.
create extension if not exists pg_net;

-- The anon key is safe to embed here (unlike a service-role key): it's the
-- same public client key shipped to the mobile app and web dashboard.
-- Access control comes from RLS + the Edge Function's own logic, not from
-- keeping this value secret. It authenticates the request only enough to
-- pass Supabase's platform-level JWT check.
create function public.notify_geofence_event()
returns trigger
language plpgsql
security definer
set search_path = public, net
as $$
begin
  perform net.http_post(
    url := 'https://sdwzlkwfqwtbkxappwjf.supabase.co/functions/v1/send-geofence-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkd3psa3dmcXd0Ymt4YXBwd2pmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNTMxMzQsImV4cCI6MjEwNDkyOTEzNH0.tbpEpnvYHnt8t_k0OQ8UzYZZ1D3VzaXI58K0YgSOP5c',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkd3psa3dmcXd0Ymt4YXBwd2pmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNTMxMzQsImV4cCI6MjEwNDkyOTEzNH0.tbpEpnvYHnt8t_k0OQ8UzYZZ1D3VzaXI58K0YgSOP5c'
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'geofence_events',
      'record', to_jsonb(new)
    )
  );
  return new;
end;
$$;

create trigger geofence_events_notify
  after insert on public.geofence_events
  for each row execute function public.notify_geofence_event();
