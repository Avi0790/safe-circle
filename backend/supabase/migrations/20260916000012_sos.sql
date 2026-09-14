-- SOS button: the last stretch goal from the proposal (page 3). One tap
-- alerts everyone who shares a circle with you, with your location.
-- Not circle-scoped (same pattern as `locations`/`profiles`): visibility
-- is "anyone who shares a circle with the triggering user", via
-- shares_circle_with(), rather than a specific circle_id.

create table public.sos_events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  message text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id),
  notified boolean not null default false
);

create index sos_events_user_idx on public.sos_events (user_id, created_at desc);

alter table public.sos_events enable row level security;

create policy "sos_events_select"
  on public.sos_events for select
  using (user_id = auth.uid() or public.shares_circle_with(user_id));

create policy "sos_events_insert_self"
  on public.sos_events for insert
  with check (user_id = auth.uid());

-- Either the person who triggered it or any circle-mate can mark it
-- resolved — same trust level the rest of the app already gives circle
-- members (e.g. everyone can already see everyone's live location).
create policy "sos_events_resolve"
  on public.sos_events for update
  using (user_id = auth.uid() or public.shares_circle_with(user_id))
  with check (user_id = auth.uid() or public.shares_circle_with(user_id));

alter publication supabase_realtime add table public.sos_events;

-- Fire-and-forget push via the same pg_net + Vault-secret pattern as
-- notify_geofence_event() (migration ...000009) — reuses the same
-- geofence_webhook_secret rather than minting a second one, since it's
-- just a shared secret proving "this call came from our own trigger,"
-- not something that needs to be event-type-specific.
create function public.notify_sos_event()
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
    url := 'https://sdwzlkwfqwtbkxappwjf.supabase.co/functions/v1/send-sos-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkd3psa3dmcXd0Ymt4YXBwd2pmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNTMxMzQsImV4cCI6MjEwNDkyOTEzNH0.tbpEpnvYHnt8t_k0OQ8UzYZZ1D3VzaXI58K0YgSOP5c',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkd3psa3dmcXd0Ymt4YXBwd2pmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNTMxMzQsImV4cCI6MjEwNDkyOTEzNH0.tbpEpnvYHnt8t_k0OQ8UzYZZ1D3VzaXI58K0YgSOP5c',
      'X-Webhook-Secret', webhook_secret
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'sos_events',
      'record', to_jsonb(new)
    )
  );
  return new;
end;
$$;

create trigger sos_events_notify
  after insert on public.sos_events
  for each row execute function public.notify_sos_event();
