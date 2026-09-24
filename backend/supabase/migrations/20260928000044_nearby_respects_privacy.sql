-- Bug fix: nearby alerts ignored two privacy features built after them.
--
-- 1. Ghost mode (migration ...000035): if Alice hides her location from
--    Bob, Bob's map never shows her — but with nearby alerts on he'd still
--    get a push saying "Alice is nearby", which reveals exactly what hiding
--    is meant to keep private. A recipient is now only notified about
--    someone who hasn't hidden from them.
-- 2. Sharing windows (migration ...000025): someone whose window has ended
--    is no longer sharing, but their last fix (up to 10 min old) was still
--    being compared against. They're now skipped entirely.
--
-- Note the hidden-from check is written as a direct query, not
-- is_hidden_by(): that helper is defined in terms of auth.uid(), which in
-- this trigger is the person who just reported a location, not the person
-- being notified.
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
    -- Someone who has stopped sharing (window ended) doesn't take part.
    if not public.is_sharing(o.user_id) then
      continue;
    end if;

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
          -- Never tell someone a person is nearby when that person has hidden
          -- their location from them (ghost mode).
          if exists (
            select 1 from public.hidden_from h
            where h.owner_id = case when r = pair_a then pair_b else pair_a end
              and h.hidden_from_id = r
          ) then
            continue;
          end if;

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
