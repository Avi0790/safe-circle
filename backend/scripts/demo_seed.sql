-- Sample data for presenting Safe Circle: a "Demo Crew" work organization
-- owned by the platform owner (platform_admins, migration ...000066), with
-- six fictional workers, a paid 10-seat plan, two job sites, nine days of
-- realistic shifts (one overnight worker), and two people on shift right now
-- near Arkansas State with a trail of positions, so the crew map, timesheets
-- and the Platform tab all have something real-looking to show.
--
--   supabase db query --linked -f scripts/demo_seed.sql     (run again to refresh)
--   supabase db query --linked -f scripts/demo_reset.sql    (remove all of it)
--
-- The demo accounts use @demo.safecircle.invalid addresses and have no
-- password: nobody can sign in as them. Running this again first removes the
-- previous demo data, so it never piles up.
do $$
declare
  owner uuid := (select user_id from public.platform_admins order by added_at limit 1);
  names text[] := array['Maya Patel', 'Jordan Lee', 'Luis Ramirez', 'Aisha Khan', 'Ben Carter', 'Priya Nair'];
  ids uuid[] := '{}';
  org uuid;
  uid uuid;
  o uuid;
  i int;
  d int;
  day_start timestamptz;
  shift_in timestamptz;
  shift_out timestamptz;
  t timestamptz;
  n int;
begin
  if owner is null then
    raise exception 'No platform owner yet: grant one first (see migration ...000066).';
  end if;

  -- start clean (same as scripts/demo_reset.sql)
  for o in
    select distinct org2.id from public.organizations org2
    join public.org_members m on m.org_id = org2.id
    join auth.users u on u.id = m.user_id
    where org2.name = 'Demo Crew' and u.email like '%@demo.safecircle.invalid'
  loop
    delete from public.shifts where org_id = o;
    delete from public.org_members where org_id = o;
    delete from public.organizations where id = o;
  end loop;
  delete from auth.users where email like '%@demo.safecircle.invalid';

  -- six fictional workers, signed up over the last two weeks
  for i in 1..array_length(names, 1) loop
    uid := gen_random_uuid();
    insert into auth.users (id, email, raw_user_meta_data, created_at)
    values (
      uid,
      'demo.' || lower(split_part(names[i], ' ', 1)) || '@demo.safecircle.invalid',
      jsonb_build_object('full_name', names[i], 'account_type', 'industry'),
      now() - make_interval(days => (i * 2) % 13, hours => i)
    );
    ids := ids || uid;
  end loop;

  -- the organization, its owner, its workers (all consented to the current disclosure)
  insert into public.organizations (name, invite_code_hash, created_by)
  values ('Demo Crew', md5(random()::text || clock_timestamp()::text), owner)
  returning id into org;
  insert into public.org_members (org_id, user_id, role, status, consented_at, consent_version)
  values (org, owner, 'owner', 'active', now(), public.org_disclosure_version());
  insert into public.org_members (org_id, user_id, role, status, consented_at, consent_version)
  select org, w, 'worker', 'active', now() - interval '10 days', public.org_disclosure_version()
  from unnest(ids) w;

  perform public.org_set_plan(org, 'active', 10);

  insert into public.job_sites (org_id, name, latitude, longitude, radius_m) values
    (org, 'ASU campus yard', 35.8423, -90.6743, 200),
    (org, 'Highland Dr site', 35.8197, -90.6620, 150);

  -- nine days of shifts, in Central time; worker 6 works nights; a rotating
  -- day off; workers 1 and 2 are on shift right now (added below)
  for d in 0..8 loop
    day_start := ((current_date - d)::timestamp) at time zone 'America/Chicago';
    for i in 1..6 loop
      continue when (i + d) % 6 = 0;          -- day off
      continue when d = 0 and i in (1, 2);    -- on shift now instead
      if i = 6 then
        shift_in := day_start - interval '2 hours';                      -- 22:00 the evening before
        shift_out := shift_in + interval '8 hours';
      else
        shift_in := day_start + interval '7 hours' + make_interval(mins => (i % 3) * 30);
        shift_out := shift_in + interval '8 hours' + make_interval(mins => ((i + d) % 3) * 20);
      end if;
      continue when shift_out > now();         -- not finished yet today
      insert into public.shifts (org_id, user_id, clocked_in_at, clocked_out_at)
      values (org, ids[i], shift_in, shift_out);
    end loop;
  end loop;

  -- on shift now, with a trail of positions every 10 minutes at the job sites
  for i in 1..2 loop
    shift_in := now() - make_interval(mins => case i when 1 then 190 else 95 end);
    -- quiet_alerted_at set: a demo worker going quiet later shouldn't page anyone
    insert into public.shifts (org_id, user_id, clocked_in_at, quiet_alerted_at)
    values (org, ids[i], shift_in, now());
    n := 0;
    t := shift_in;
    while t < now() loop
      insert into public.locations (user_id, latitude, longitude, accuracy, battery_level, speed, recorded_at)
      values (
        ids[i],
        case i when 1 then 35.8423 else 35.8197 end + sin(n / 3.0) * 0.0009,
        case i when 1 then -90.6743 else -90.6620 end + cos(n / 3.0) * 0.0011,
        10,
        greatest(0.35, 0.95 - n * 0.02),
        0.6,
        t
      );
      n := n + 1;
      t := t + interval '10 minutes';
    end loop;
    insert into public.locations (user_id, latitude, longitude, accuracy, battery_level, speed, recorded_at)
    values (ids[i], case i when 1 then 35.8425 else 35.8199 end, case i when 1 then -90.6740 else -90.6618 end, 8, 0.6, 0, now() - interval '1 minute');
  end loop;
end $$;
