-- "Nearby" alerts: get a push when a circle-mate comes close, so you don't
-- have to check the map (e.g. while driving). Same server-side pattern as
-- geofencing: a trigger on every location insert compares the new fix to
-- circle-mates' recent positions and, on a far -> near transition, fires the
-- send-nearby-push Edge Function via pg_net + the shared Vault secret.
--
-- Opt-in per person (profiles.nearby_alerts, default off) — it only ever
-- reveals what circle-mates can already see on the map, but an alert every
-- time someone drives past shouldn't be on by default.
alter table public.profiles add column nearby_alerts boolean not null default false;

-- One row per unordered pair (user_a < user_b) so a transition is detected
-- once, then each opted-in side is notified. Server-only: RLS on, no policies.
create table public.nearby_pairs (
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  is_near boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);
alter table public.nearby_pairs enable row level security;

create function public.evaluate_nearby()
returns trigger
language plpgsql
security definer
set search_path = public, net, vault
as $$
declare
  o record;
  r uuid;
  dist double precision;
  pair_a uuid;
  pair_b uuid;
  was_near boolean;
  now_near boolean;
  webhook_secret text;
begin
  select decrypted_secret into webhook_secret
  from vault.decrypted_secrets
  where name = 'geofence_webhook_secret';

  -- Latest fix (within 10 min, so we never compare against a stale spot)
  -- for everyone who shares any circle with the person who just reported.
  for o in
    select distinct on (l.user_id) l.user_id, l.latitude, l.longitude
    from public.locations l
    where l.recorded_at > now() - interval '10 minutes'
      and l.user_id in (
        select cm2.user_id
        from public.circle_members cm1
        join public.circle_members cm2 on cm2.circle_id = cm1.circle_id
        where cm1.user_id = new.user_id and cm2.user_id <> new.user_id
      )
    order by l.user_id, l.recorded_at desc
  loop
    dist := public.haversine_meters(new.latitude, new.longitude, o.latitude, o.longitude);
    pair_a := least(new.user_id, o.user_id);
    pair_b := greatest(new.user_id, o.user_id);

    select is_near into was_near
    from public.nearby_pairs where user_a = pair_a and user_b = pair_b;
    was_near := coalesce(was_near, false);

    -- Hysteresis: 500m to become "near", 800m to stop, so GPS jitter at the
    -- boundary can't fire an alert every minute.
    now_near := case when was_near then dist <= 800 else dist <= 500 end;

    if now_near <> was_near then
      insert into public.nearby_pairs (user_a, user_b, is_near, updated_at)
      values (pair_a, pair_b, now_near, now())
      on conflict (user_a, user_b)
        do update set is_near = excluded.is_near, updated_at = excluded.updated_at;

      if now_near then
        for r in
          select id from public.profiles where id in (pair_a, pair_b) and nearby_alerts
        loop
          perform net.http_post(
            url := 'https://sdwzlkwfqwtbkxappwjf.supabase.co/functions/v1/send-nearby-push',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkd3psa3dmcXd0Ymt4YXBwd2pmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNTMxMzQsImV4cCI6MjEwNDkyOTEzNH0.tbpEpnvYHnt8t_k0OQ8UzYZZ1D3VzaXI58K0YgSOP5c',
              'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkd3psa3dmcXd0Ymt4YXBwd2pmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNTMxMzQsImV4cCI6MjEwNDkyOTEzNH0.tbpEpnvYHnt8t_k0OQ8UzYZZ1D3VzaXI58K0YgSOP5c',
              'X-Webhook-Secret', webhook_secret
            ),
            body := jsonb_build_object(
              'recipient_id', r,
              'other_id', case when r = pair_a then pair_b else pair_a end,
              'meters', round(dist)
            )
          );
        end loop;
      end if;
    end if;
  end loop;

  return new;
end;
$$;

create trigger locations_evaluate_nearby
  after insert on public.locations
  for each row execute function public.evaluate_nearby();
