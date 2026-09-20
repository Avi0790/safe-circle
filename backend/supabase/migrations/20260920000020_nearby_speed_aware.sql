-- Speed-aware nearby alerts. A fixed 500 m radius is fine on foot but useless
-- at road speed: fixes arrive up to ~60 s apart, and a car covers 500 m in
-- about 20 s, so the alert would land after you'd already passed. Scale the
-- "near" radius with how fast the two people are moving instead:
--
--   enter radius = clamp(500 m, ~45 s of combined travel, 3000 m)
--   exit radius  = max(800 m, 1.6 x enter radius)   (hysteresis)
--
-- e.g. walking (1.4 + 1.4 m/s) -> 500 m; one person at 25 m/s (~56 mph) ->
-- ~1.1 km; two cars at 25 m/s -> ~2.2 km. Speeds are m/s from the GPS fix
-- (locations.speed); the other person's speed only counts if their fix is
-- under 2 minutes old — an old fix's speed says nothing about right now.
create or replace function public.evaluate_nearby()
returns trigger
language plpgsql
security definer
set search_path = public, net, vault
as $$
declare
  o record;
  r uuid;
  dist double precision;
  my_speed double precision;
  other_speed double precision;
  enter_m double precision;
  exit_m double precision;
  pair_a uuid;
  pair_b uuid;
  was_near boolean;
  now_near boolean;
  webhook_secret text;
begin
  select decrypted_secret into webhook_secret
  from vault.decrypted_secrets
  where name = 'geofence_webhook_secret';

  my_speed := coalesce(new.speed, 0);

  for o in
    select distinct on (l.user_id) l.user_id, l.latitude, l.longitude, l.speed, l.recorded_at
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

    other_speed := case
      when o.recorded_at > now() - interval '2 minutes' then coalesce(o.speed, 0)
      else 0
    end;
    enter_m := least(3000, greatest(500, (my_speed + other_speed) * 45));
    exit_m := greatest(800, enter_m * 1.6);

    select is_near into was_near
    from public.nearby_pairs where user_a = pair_a and user_b = pair_b;
    was_near := coalesce(was_near, false);

    now_near := case when was_near then dist <= exit_m else dist <= enter_m end;

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
