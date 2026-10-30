-- Load test: does it stay fast with a real-sized crowd? Builds, inside one
-- transaction that rolls itself back, a work organization with 200 workers
-- on shift (a manager leading a team of 40) and 25 family circles of 4, each
-- person with 3 days of location history (~115,000 positions, written
-- through the same triggers a phone's upload goes through), then times the
-- queries the apps run, as the person who runs them, through row-level
-- security. Each line: PASS/FAIL, rows returned, and the best of 3 runs in ms
-- against a generous limit.
--
-- LOCAL / CI ONLY (tests/run_all.sh skips tests/load with --linked): it
-- writes a lot, briefly, and isn't something to do to the live project.
create function pg_temp.sw(u uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.su() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
create function pg_temp.line(label text, rows bigint, expect bigint, ms numeric, limit_ms int) returns text language sql as $$
  select case when rows = expect and ms <= limit_ms then 'PASS ' else 'FAIL ' end
    || label || format(' — %s rows (expected %s), %s ms (limit %s ms)', rows, expect, round(ms, 1), limit_ms) || E'\n'
$$;

do $$
declare
  owner uuid;
  mgr uuid;
  org uuid;
  team uuid;
  workers uuid[];
  family uuid[];
  circ uuid;
  i int;
  run int;
  t0 timestamptz;
  ms numeric;
  best numeric;
  n bigint;
  total bigint;
  msg text := '';
  setup_start timestamptz := clock_timestamp();
begin
  -- ===== people =====
  with ins as (
    insert into auth.users (id, email, raw_user_meta_data)
    select gen_random_uuid(), 'load.worker' || g || '@test.invalid', jsonb_build_object('full_name', 'Worker ' || g)
    from generate_series(1, 200) g
    returning id
  ) select array_agg(id) into workers from ins;
  with ins as (
    insert into auth.users (id, email, raw_user_meta_data)
    select gen_random_uuid(), 'load.family' || g || '@test.invalid', jsonb_build_object('full_name', 'Family ' || g)
    from generate_series(1, 100) g
    returning id
  ) select array_agg(id) into family from ins;
  insert into auth.users (id, email, raw_user_meta_data)
  values (gen_random_uuid(), 'load.owner@test.invalid', '{"full_name":"Load Owner"}') returning id into owner;
  insert into auth.users (id, email, raw_user_meta_data)
  values (gen_random_uuid(), 'load.manager@test.invalid', '{"full_name":"Load Manager"}') returning id into mgr;

  -- ===== the organization: everyone consented, a 500-seat plan =====
  insert into public.organizations (name, invite_code_hash, created_by)
  values ('Load Crew', md5(random()::text || clock_timestamp()::text), owner) returning id into org;
  insert into public.org_members (org_id, user_id, role, status, consented_at, consent_version)
  values (org, owner, 'owner', 'active', now(), public.org_disclosure_version()),
         (org, mgr, 'manager', 'active', now(), public.org_disclosure_version());
  insert into public.org_members (org_id, user_id, role, status, consented_at, consent_version)
  select org, w, 'worker', 'active', now(), public.org_disclosure_version() from unnest(workers) w;
  perform public.org_set_plan(org, 'active', 500);
  insert into public.teams (org_id, name) values (org, 'Team A') returning id into team;
  insert into public.team_members (team_id, user_id, is_lead) values (team, mgr, true);
  insert into public.team_members (team_id, user_id, is_lead)
  select team, workers[g], false from generate_series(1, 40) g;

  -- everyone on shift for the last hour (quiet_alerted_at: no quiet-phone pages)
  insert into public.shifts (org_id, user_id, clocked_in_at, quiet_alerted_at)
  select org, w, now() - interval '1 hour', now() from unnest(workers) w;

  -- ===== 25 family circles of 4, all sharing =====
  for i in 0..24 loop
    insert into public.circles (name, invite_code_hash, created_by)
    values ('Family ' || i, md5(random()::text || i || clock_timestamp()::text), family[i * 4 + 1]) returning id into circ;
    insert into public.circle_members (circle_id, user_id)
    select circ, family[i * 4 + g] from generate_series(1, 4) g;
  end loop;
  foreach circ in array family loop
    perform pg_temp.sw(circ);
    perform public.set_share_window(null);
  end loop;
  perform pg_temp.su();

  -- ===== location history =====
  -- workers: every minute of the current shift, plus 3 days off shift every 15 min
  insert into public.locations (user_id, latitude, longitude, accuracy, battery_level, speed, recorded_at)
  select w, 35.84 + random() * 0.01, -90.67 + random() * 0.01, 10, 0.8, 0, now() - make_interval(mins => m)
  from unnest(workers) w, generate_series(0, 59) m;
  insert into public.locations (user_id, latitude, longitude, accuracy, battery_level, speed, recorded_at)
  select w, 35.84 + random() * 0.05, -90.67 + random() * 0.05, 15, 0.8, 0, now() - interval '1 hour' - make_interval(mins => m * 15)
  from unnest(workers) w, generate_series(1, 288) m;
  -- family: 3 days every 10 minutes
  insert into public.locations (user_id, latitude, longitude, accuracy, battery_level, speed, recorded_at)
  select f, 35.80 + random() * 0.05, -90.70 + random() * 0.05, 12, 0.7, 0, now() - make_interval(mins => m * 10)
  from unnest(family) f, generate_series(0, 431) m;
  select count(*) into total from public.locations where user_id = any(workers) or user_id = any(family);
  analyze public.locations;
  msg := msg || format('INFO built %s positions for 302 people in %s s', total,
                       round(extract(epoch from clock_timestamp() - setup_start)::numeric, 1)) || E'\n';

  -- ===== the queries the apps run =====
  -- web and phone crew map, as the owner: all 200 on shift
  best := null;
  for run in 1..3 loop
    perform pg_temp.sw(owner);
    t0 := clock_timestamp();
    select count(*) into n from public.org_live_roster(org);
    ms := extract(epoch from clock_timestamp() - t0) * 1000;
    best := least(coalesce(best, ms), ms);
  end loop;
  perform pg_temp.su();
  msg := msg || pg_temp.line('owner''s live crew map (200 on shift)', n, 200, best, 1000);

  -- as the manager: only their team of 40
  best := null;
  for run in 1..3 loop
    perform pg_temp.sw(mgr);
    t0 := clock_timestamp();
    select count(*) into n from public.org_live_roster(org);
    ms := extract(epoch from clock_timestamp() - t0) * 1000;
    best := least(coalesce(best, ms), ms);
  end loop;
  perform pg_temp.su();
  msg := msg || pg_temp.line('manager''s live crew map (their team of 40)', n, 40, best, 1000);

  -- a worker's track for the day: only the 60 positions from this shift
  best := null;
  for run in 1..3 loop
    perform pg_temp.sw(owner);
    t0 := clock_timestamp();
    select count(*) into n from public.org_worker_track(org, workers[1], now() - interval '1 day', now());
    ms := extract(epoch from clock_timestamp() - t0) * 1000;
    best := least(coalesce(best, ms), ms);
  end loop;
  perform pg_temp.su();
  msg := msg || pg_temp.line('one worker''s shift track (on-shift positions only)', n, 60, best, 500);

  -- family map: the circle's latest positions
  best := null;
  for run in 1..3 loop
    perform pg_temp.sw(family[1]);
    t0 := clock_timestamp();
    select count(*) into n from public.latest_locations where user_id = any(family[1:4]);
    ms := extract(epoch from clock_timestamp() - t0) * 1000;
    best := least(coalesce(best, ms), ms);
  end loop;
  perform pg_temp.su();
  msg := msg || pg_temp.line('family map: a circle''s latest positions', n, 4, best, 500);

  -- a circle-mate's trail (member screen: the latest 100)
  best := null;
  for run in 1..3 loop
    perform pg_temp.sw(family[1]);
    t0 := clock_timestamp();
    select count(*) into n from (
      select id from public.locations where user_id = family[2] order by recorded_at desc limit 100
    ) trail;
    ms := extract(epoch from clock_timestamp() - t0) * 1000;
    best := least(coalesce(best, ms), ms);
  end loop;
  perform pg_temp.su();
  msg := msg || pg_temp.line('a circle-mate''s trail (latest 100)', n, 100, best, 500);

  -- the privacy rules under load: a worker scanning for anyone else's positions
  best := null;
  for run in 1..3 loop
    perform pg_temp.sw(workers[2]);
    t0 := clock_timestamp();
    select count(*) into n from public.locations where user_id <> workers[2];
    ms := extract(epoch from clock_timestamp() - t0) * 1000;
    best := least(coalesce(best, ms), ms);
  end loop;
  perform pg_temp.su();
  msg := msg || pg_temp.line('a worker sees none of the other ~115,000 positions', n, 0, best, 3000);

  -- a phone uploading: 100 single positions, through RLS and every trigger
  perform pg_temp.sw(family[3]);
  t0 := clock_timestamp();
  for run in 1..100 loop
    insert into public.locations (user_id, latitude, longitude, accuracy, battery_level, speed, recorded_at)
    values (family[3], 35.81, -90.69, 10, 0.7, 0, now());
  end loop;
  ms := extract(epoch from clock_timestamp() - t0) * 1000 / 100;
  perform pg_temp.su();
  msg := msg || pg_temp.line('one location upload (average of 100)', 1, 1, ms, 50);

  raise exception E'RESULT\n%', msg;
end $$;
