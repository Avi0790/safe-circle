-- Security fix: send-geofence-push previously trusted its request body
-- with no real authentication. `verify_jwt` on the Edge Function only
-- checks that *some* valid Supabase JWT was presented — the public anon
-- key satisfies that trivially, since it's embedded in every client.
-- Nothing verified the request actually came from our own pg_net
-- trigger, so anyone holding the anon key could POST a fabricated
-- {record: {place_id, user_id, event_type}} straight to the function's
-- URL and trigger a real push notification to real circle members.
--
-- Fix: a random shared secret, generated here and never written in
-- plaintext to any git-tracked file, sent as a custom header by the
-- trigger and checked by the Edge Function before it trusts the payload.

create extension if not exists supabase_vault;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'geofence_webhook_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'geofence_webhook_secret');
  end if;
end $$;

-- Deploy-time-only accessor so the machine running `supabase db push` can
-- read the generated secret out once, to mirror it into the Edge
-- Function's env via `supabase secrets set`. Locked down to service_role
-- in this same migration (never reachable via anon/authenticated, even
-- briefly), and dropped entirely by migration ...000010 once that
-- one-time sync has happened.
create function public._read_geofence_webhook_secret()
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'geofence_webhook_secret';
$$;

revoke execute on function public._read_geofence_webhook_secret() from public, anon, authenticated;

-- Redefine the trigger to send the secret as a header.
create or replace function public.notify_geofence_event()
returns trigger
language plpgsql
security definer
set search_path = public, net, vault
as $$
declare
  webhook_secret text;
begin
  select decrypted_secret into webhook_secret
  from vault.decrypted_secrets
  where name = 'geofence_webhook_secret';

  perform net.http_post(
    url := 'https://sdwzlkwfqwtbkxappwjf.supabase.co/functions/v1/send-geofence-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkd3psa3dmcXd0Ymt4YXBwd2pmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNTMxMzQsImV4cCI6MjEwNDkyOTEzNH0.tbpEpnvYHnt8t_k0OQ8UzYZZ1D3VzaXI58K0YgSOP5c',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkd3psa3dmcXd0Ymt4YXBwd2pmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNTMxMzQsImV4cCI6MjEwNDkyOTEzNH0.tbpEpnvYHnt8t_k0OQ8UzYZZ1D3VzaXI58K0YgSOP5c',
      'X-Webhook-Secret', webhook_secret
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
