-- Sample data for presenting Safe Circle: a "Demo Crew" work organization
-- owned by the platform owner (platform_admins, migration ...000066), with
-- six fictional workers and a fictional manager who leads three of them, a
-- paid 10-seat plan, two job sites, eight weeks of realistic shifts (one
-- overnight worker), two people on shift right now near Arkansas State with a
-- trail of positions, and eight weeks of safety history: SOS alerts the
-- manager answered (and one nobody did), missed check-ins, quiet phones,
-- location views and incident reports, and a planned schedule from last
-- week to next. So the crew map, timesheets, the Schedule, the Safety
-- report, Incidents and the Platform tab all have something real-looking to
-- show.
--
-- Nothing here sends a notification: the past SOS alerts are added before
-- the shifts they fall in (so no one was "on shift" to be told) and already
-- resolved, and the rest goes straight into the tables.
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
  mgr uuid;
  team uuid;
  e bigint;
  r record;
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

  -- a fictional manager, who leads the North team (Maya, Jordan, Luis)
  mgr := gen_random_uuid();
  insert into auth.users (id, email, raw_user_meta_data, created_at)
  values (mgr, 'demo.grace@demo.safecircle.invalid', '{"full_name":"Grace Kim","account_type":"industry"}', now() - interval '60 days');

  -- the organization, its owner, its workers (all consented to the current disclosure)
  insert into public.organizations (name, invite_code_hash, created_by)
  values ('Demo Crew', md5(random()::text || clock_timestamp()::text), owner)
  returning id into org;
  insert into public.org_members (org_id, user_id, role, status, consented_at, consent_version)
  values (org, owner, 'owner', 'active', now(), public.org_disclosure_version());
  insert into public.org_members (org_id, user_id, role, status, consented_at, consent_version)
  select org, w, 'worker', 'active', now() - interval '10 days', public.org_disclosure_version()
  from unnest(ids) w;

  insert into public.org_members (org_id, user_id, role, status, consented_at, consent_version)
  values (org, mgr, 'manager', 'active', now() - interval '60 days', public.org_disclosure_version());
  insert into public.teams (org_id, name) values (org, 'North') returning id into team;
  insert into public.team_members (team_id, user_id, is_lead) values (team, mgr, true);
  insert into public.team_members (team_id, user_id, is_lead) select team, ids[g], false from generate_series(1, 3) g;

  perform public.org_set_plan(org, 'active', 10);

  insert into public.job_sites (org_id, name, latitude, longitude, radius_m) values
    (org, 'ASU campus yard', 35.8423, -90.6743, 200),
    (org, 'Highland Dr site', 35.8197, -90.6620, 150);

  -- eight weeks of SOS alerts on shift, all resolved: Grace answered seven
  -- within minutes; the one in week 4 nobody answered. Added before the
  -- shifts they fall in, so no one is told about them now.
  for r in
    select * from (values
      (3, 2, 3), (10, 4, 6), (17, 3, 2), (24, 5, null), (31, 3, 4), (38, 2, 8), (45, 4, 3), (52, 1, 5)
    ) v(days_ago, who, answered_after_min)
  loop
    day_start := ((current_date - r.days_ago)::timestamp) at time zone 'America/Chicago';
    t := day_start + interval '10 hours 20 minutes';
    insert into public.sos_events (user_id, latitude, longitude, created_at, resolved_at, resolved_by, notified)
    values (ids[r.who], 35.8423 + r.who * 0.001, -90.6743 - r.who * 0.001, t, t + interval '25 minutes', ids[r.who], true)
    returning id into e;
    if r.answered_after_min is not null then
      insert into public.sos_acknowledgements (sos_event_id, user_id, created_at)
      values (e, mgr, t + make_interval(mins => r.answered_after_min));
    end if;
  end loop;

  -- eight weeks of shifts, in Central time; worker 6 works nights; a rotating
  -- day off; workers 1 and 2 are on shift right now (added below)
  for d in 0..55 loop
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

  -- missed check-ins and quiet phones over the eight weeks (what the
  -- scheduled jobs would have logged), each during that worker's shift
  for r in
    select * from (values
      (2, 3, 'quiet_phone'), (6, 1, 'missed_checkin'), (9, 5, 'quiet_phone'), (13, 2, 'quiet_phone'),
      (20, 1, 'missed_checkin'), (27, 4, 'quiet_phone'), (33, 1, 'quiet_phone'), (40, 5, 'missed_checkin'),
      (47, 2, 'quiet_phone'), (54, 3, 'missed_checkin')
    ) v(days_ago, who, kind)
  loop
    day_start := ((current_date - r.days_ago)::timestamp) at time zone 'America/Chicago';
    insert into public.org_safety_events (org_id, user_id, kind, created_at)
    values (org, ids[r.who], r.kind, day_start + interval '12 hours 40 minutes');
  end loop;

  -- Grace looking at her team on the live map, a few times a week
  insert into public.org_audit (org_id, actor_id, target_id, action, created_at)
  select org, mgr, ids[1 + (g % 3)], case when g % 4 = 0 then 'viewed_track' else 'viewed_live' end,
         ((current_date - (g * 2))::timestamp at time zone 'America/Chicago') + interval '9 hours 15 minutes'
  from generate_series(0, 27) g;

  -- incident reports: some resolved, a hazard and a minor injury still open
  for r in
    select * from (values
      (1, 2, 'hazard', 'Loose guardrail on the loading dock stairs, east side.', false),
      (2, 4, 'injury', 'Small cut on my hand from sheet metal. First aid kit used, I''m fine.', false),
      (6, 1, 'near_miss', 'Forklift reversed without the beeper. Nobody hurt.', true),
      (15, 3, 'hazard', 'Puddle of hydraulic fluid by bay 3.', true),
      (29, 5, 'other', 'Gate code at Highland Dr changed without notice.', true),
      (43, 2, 'hazard', 'Extension cord across the walkway at the yard.', true)
    ) v(days_ago, who, kind, note, resolved)
  loop
    day_start := ((current_date - r.days_ago)::timestamp) at time zone 'America/Chicago';
    t := day_start + interval '11 hours';
    insert into public.incident_reports (org_id, user_id, kind, note, latitude, longitude, status, resolved_by, resolved_at, created_at)
    values (
      org, ids[r.who], r.kind, r.note, 35.8423 + r.who * 0.0004, -90.6743 + r.who * 0.0004,
      case when r.resolved then 'resolved' else 'open' end,
      case when r.resolved then mgr end,
      case when r.resolved then t + interval '3 hours' end,
      t
    );
  end loop;
  -- the schedule (migration ...000074): last week, this week and next, as
  -- planned. Most match the real clock-ins; worker 4 was planned half an hour
  -- before they came in five days ago (late), and worker 5 was planned on a
  -- day they didn't come (missed). Straight into the table: no notifications.
  if to_regclass('public.scheduled_shifts') is not null then
    for d in -7..13 loop
      day_start := ((current_date - d)::timestamp) at time zone 'America/Chicago';
      for i in 1..6 loop
        continue when (i + d) % 6 = 0 and not (i = 5 and d = 1);
        if d = 0 and i in (1, 2) then
          shift_in := now() - make_interval(mins => case i when 1 then 195 else 100 end);
        elsif i = 6 then
          shift_in := day_start - interval '2 hours';
        else
          shift_in := day_start + interval '7 hours' + make_interval(mins => (i % 3) * 30);
        end if;
        -- today's that began but aren't in shifts yet (they're added once finished)
        continue when d = 0 and i not in (1, 2) and shift_in < now() and shift_in + interval '8 hours' > now();
        if i = 4 and d = 5 then
          shift_in := shift_in - interval '30 minutes';
        end if;
        execute 'insert into public.scheduled_shifts (org_id, user_id, starts_at, ends_at, note, created_by)
                 values ($1, $2, $3, $4, $5, $6)'
          using org, ids[i], shift_in, shift_in + interval '8 hours',
                case when i = 6 then 'Night shift at the yard' end,
                case when i <= 3 then mgr else owner end;
      end loop;
    end loop;
  end if;
end $$;
