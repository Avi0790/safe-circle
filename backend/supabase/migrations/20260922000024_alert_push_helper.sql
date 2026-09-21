-- One internal helper for "push this text to these people", used by the
-- walk-me-home and ride-request features (and anything after them) instead
-- of a new trigger + Edge Function per alert type. The SQL side decides
-- who and what to say; the send-alert-push Edge Function only looks up
-- push tokens and delivers. Same pg_net + Vault shared-secret pattern as
-- notify_new_message() (migration ...000017).
create function public.send_alert_push(
  p_recipients uuid[],
  p_title text,
  p_body text,
  p_data jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, net, vault
as $$
declare
  webhook_secret text;
begin
  if p_recipients is null or cardinality(p_recipients) = 0 then
    return;
  end if;

  select decrypted_secret into webhook_secret
  from vault.decrypted_secrets
  where name = 'geofence_webhook_secret';

  perform net.http_post(
    url := 'https://sdwzlkwfqwtbkxappwjf.supabase.co/functions/v1/send-alert-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkd3psa3dmcXd0Ymt4YXBwd2pmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNTMxMzQsImV4cCI6MjEwNDkyOTEzNH0.tbpEpnvYHnt8t_k0OQ8UzYZZ1D3VzaXI58K0YgSOP5c',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkd3psa3dmcXd0Ymt4YXBwd2pmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNTMxMzQsImV4cCI6MjEwNDkyOTEzNH0.tbpEpnvYHnt8t_k0OQ8UzYZZ1D3VzaXI58K0YgSOP5c',
      'X-Webhook-Secret', webhook_secret
    ),
    body := jsonb_build_object(
      'recipient_ids', to_jsonb(p_recipients),
      'title', p_title,
      'body', p_body,
      'data', p_data
    )
  );
end;
$$;

-- Functions in `public` are callable by any signed-in user through the
-- PostgREST /rpc endpoint by default. This one must NOT be: it would let
-- anyone push arbitrary text to any user. Only other security-definer
-- functions (which run as the owner) may call it.
revoke all on function public.send_alert_push(uuid[], text, text, jsonb)
  from public, anon, authenticated;
