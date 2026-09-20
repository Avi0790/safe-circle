-- Low-battery push to the circle. The apps already flag a low battery in the
-- UI (<= 20%) but only if you happen to be looking; a dead phone is the
-- number-one reason someone silently disappears from the map, so tell people
-- proactively. Same server-side pattern as geofence/SOS/chat/nearby: a
-- trigger on location inserts, pg_net, the shared Vault secret, and an Edge
-- Function that finds the circle-mates' push tokens.
--
-- Stateless dedupe: fire only if this person has had NO other low-battery ping
-- in the last 2 hours. That alerts once when they drop into "low", not on
-- every ping while they stay there, and not again if the level flaps around
-- 20% (charging / discharging) within the same episode.
create function public.notify_low_battery()
returns trigger
language plpgsql
security definer
set search_path = public, net, vault
as $$
declare
  webhook_secret text;
begin
  if exists (
    select 1 from public.locations l
    where l.user_id = new.user_id
      and l.id <> new.id
      and l.battery_level <= 0.2
      and l.recorded_at > now() - interval '2 hours'
  ) then
    return new;
  end if;

  select decrypted_secret into webhook_secret
  from vault.decrypted_secrets
  where name = 'geofence_webhook_secret';

  perform net.http_post(
    url := 'https://sdwzlkwfqwtbkxappwjf.supabase.co/functions/v1/send-battery-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkd3psa3dmcXd0Ymt4YXBwd2pmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNTMxMzQsImV4cCI6MjEwNDkyOTEzNH0.tbpEpnvYHnt8t_k0OQ8UzYZZ1D3VzaXI58K0YgSOP5c',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkd3psa3dmcXd0Ymt4YXBwd2pmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNTMxMzQsImV4cCI6MjEwNDkyOTEzNH0.tbpEpnvYHnt8t_k0OQ8UzYZZ1D3VzaXI58K0YgSOP5c',
      'X-Webhook-Secret', webhook_secret
    ),
    body := jsonb_build_object(
      'user_id', new.user_id,
      'battery', new.battery_level
    )
  );
  return new;
end;
$$;

-- The WHEN clause keeps this off the hot path: it only runs at all on the
-- (rare) pings that report a low battery.
create trigger locations_notify_low_battery
  after insert on public.locations
  for each row
  when (new.battery_level is not null and new.battery_level <= 0.2)
  execute function public.notify_low_battery();
