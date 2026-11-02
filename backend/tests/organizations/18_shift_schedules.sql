-- Shift schedules (migration ...000074). Rolls itself back; results in the
-- error text.
create function pg_temp.sw(u uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.su() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
create function pg_temp.ok(label text, cond boolean) returns text language sql as $$
  select case when cond is true then 'PASS ' else 'FAIL ' end || label || E'\n'
$$;
create function pg_temp.err(sql text) returns text language plpgsql as $$
begin execute sql; return null; exception when others then return sqlerrm; end $$;

do $$
declare
  o  uuid := '00000000-0000-0000-0000-0000000000a0';
  m1 uuid := '00000000-0000-0000-0000-0000000000b1';  -- leads w1
  m2 uuid := '00000000-0000-0000-0000-0000000000b2';  -- leads w2
  w1 uuid := '00000000-0000-0000-0000-0000000000c1';
  w2 uuid := '00000000-0000-0000-0000-0000000000c2';
  x  uuid := '00000000-0000-0000-0000-0000000000d1';
  org uuid; code text; ta uuid; tb uuid; r uuid;
  s_next uuid; s_late uuid; s_missed uuid; s_w2 uuid; inc uuid;
  n int; txt text; st text; tomorrow timestamptz := date_trunc('hour', now()) + interval '1 day';
  msg text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (o, 'o@test.invalid', '{"full_name":"Olive"}'), (m1, 'm1@test.invalid', '{"full_name":"Max"}'),
    (m2, 'm2@test.invalid', '{"full_name":"Mia"}'), (w1, 'w1@test.invalid', '{"full_name":"Wendy"}'),
    (w2, 'w2@test.invalid', '{"full_name":"Walt"}'), (x, 'x@test.invalid', '{"full_name":"Out"}');
  perform pg_temp.sw(o);
  select c.org_id, c.invite_code into org, code from public.create_organization('Crew') c;
  foreach r in array array[m1, m2, w1, w2] loop
    perform pg_temp.sw(r); perform public.redeem_org_invite_code(code); perform public.accept_org_consent(org);
  end loop;
  perform pg_temp.sw(o);
  perform public.set_org_member_role(org, m1, 'manager'); perform public.set_org_member_role(org, m2, 'manager');
  ta := public.create_team(org, 'A'); tb := public.create_team(org, 'B');
  perform public.set_team_member(ta, m1, true); perform public.set_team_member(ta, w1, false);
  perform public.set_team_member(tb, m2, true); perform public.set_team_member(tb, w2, false);

  -- ===== planning =====
  perform pg_temp.sw(m1);
  s_next := public.schedule_shift(org, w1, tomorrow, tomorrow + interval '8 hours', '  Bring the ladder  ');
  perform pg_temp.su();
  select note into txt from public.scheduled_shifts where id = s_next;
  msg := msg || pg_temp.ok('a manager plans a shift for a worker on their team', txt = 'Bring the ladder');

  perform pg_temp.sw(m1);
  txt := pg_temp.err(format('select public.schedule_shift(%L, %L, %L, %L)', org, w2, tomorrow, tomorrow + interval '8 hours'));
  msg := msg || pg_temp.ok('but not for a worker on another team', txt like 'Only owners%');
  txt := pg_temp.err(format('select public.schedule_shift(%L, %L, %L, %L)', org, w1, tomorrow + interval '4 hours', tomorrow + interval '10 hours'));
  msg := msg || pg_temp.ok('two shifts can''t overlap', txt = 'They already have a shift then.');
  txt := pg_temp.err(format('select public.schedule_shift(%L, %L, %L, %L)', org, w1, tomorrow + interval '2 days', tomorrow + interval '2 days 17 hours'));
  msg := msg || pg_temp.ok('at most 16 hours', txt like 'A shift can be at most 16%');
  txt := pg_temp.err(format('select public.schedule_shift(%L, %L, %L, %L)', org, w1, tomorrow, tomorrow - interval '1 hour'));
  msg := msg || pg_temp.ok('it has to end after it starts', txt like 'A shift has to end%');
  txt := pg_temp.err(format('select public.schedule_shift(%L, %L, %L, %L)', org, m2, tomorrow, tomorrow + interval '8 hours'));
  perform pg_temp.sw(o);
  txt := pg_temp.err(format('select public.schedule_shift(%L, %L, %L, %L)', org, m2, tomorrow, tomorrow + interval '8 hours'));
  msg := msg || pg_temp.ok('shifts are for workers, not managers', txt = 'Shifts are planned for workers.');
  perform pg_temp.sw(w1);
  txt := pg_temp.err(format('select public.schedule_shift(%L, %L, %L, %L)', org, w1, tomorrow + interval '3 days', tomorrow + interval '3 days 8 hours'));
  msg := msg || pg_temp.ok('a worker can''t plan their own', txt like 'Only owners%');
  perform pg_temp.sw(x);
  txt := pg_temp.err(format('select public.schedule_shift(%L, %L, %L, %L)', org, w1, tomorrow + interval '3 days', tomorrow + interval '3 days 8 hours'));
  msg := msg || pg_temp.ok('nor can an outsider', txt like 'Only owners%');
  perform pg_temp.sw(o);
  s_w2 := public.schedule_shift(org, w2, tomorrow, tomorrow + interval '6 hours');
  txt := pg_temp.err(format('insert into public.scheduled_shifts (org_id, user_id, starts_at, ends_at) values (%L, %L, %L, %L)', org, w2, tomorrow + interval '5 days', tomorrow + interval '5 days 8 hours'));
  msg := msg || pg_temp.ok('no writing to the schedule directly', txt is not null);

  -- ===== who sees what =====
  perform pg_temp.sw(w1); select count(*) into n from public.scheduled_shifts;
  msg := msg || pg_temp.ok('a worker sees only their own shifts', n = 1);
  perform pg_temp.sw(m1); select count(*) into n from public.scheduled_shifts;
  msg := msg || pg_temp.ok('a manager sees their team''s', n = 1);
  perform pg_temp.sw(o); select count(*) into n from public.scheduled_shifts;
  msg := msg || pg_temp.ok('the owner sees everyone''s', n = 2);
  perform pg_temp.sw(x); select count(*) into n from public.scheduled_shifts;
  msg := msg || pg_temp.ok('an outsider sees none', n = 0);

  -- ===== planned against actual =====
  perform pg_temp.su();
  insert into public.scheduled_shifts (org_id, user_id, starts_at, ends_at)
  values (org, w1, now() - interval '30 hours', now() - interval '22 hours') returning id into s_late;
  insert into public.shifts (org_id, user_id, clocked_in_at, clocked_out_at)
  values (org, w1, now() - interval '29 hours 40 minutes', now() - interval '21 hours');
  insert into public.scheduled_shifts (org_id, user_id, starts_at, ends_at)
  values (org, w1, now() - interval '54 hours', now() - interval '46 hours') returning id into s_missed;
  perform pg_temp.sw(m1);
  select status into st from public.org_schedule(org, now() - interval '3 days', now() + interval '3 days') where id = s_late;
  msg := msg || pg_temp.ok('clocked in 20 minutes after the start: late', st = 'late');
  select status into st from public.org_schedule(org, now() - interval '3 days', now() + interval '3 days') where id = s_missed;
  msg := msg || pg_temp.ok('never clocked in: missed', st = 'missed');
  select status into st from public.org_schedule(org, now() - interval '3 days', now() + interval '3 days') where id = s_next;
  msg := msg || pg_temp.ok('tomorrow''s: upcoming', st = 'upcoming');
  select count(*) into n from public.org_schedule(org, now() - interval '3 days', now() + interval '3 days');
  msg := msg || pg_temp.ok('the manager''s schedule view is just their team', n = 3);

  -- ===== cancelling =====
  perform pg_temp.sw(m2);
  txt := pg_temp.err(format('select public.cancel_scheduled_shift(%L)', s_next));
  msg := msg || pg_temp.ok('another team''s manager can''t cancel it', txt = 'Shift not found.');
  perform pg_temp.sw(m1);
  perform public.cancel_scheduled_shift(s_next);
  perform pg_temp.su();
  msg := msg || pg_temp.ok('the worker''s manager can', not exists (select 1 from public.scheduled_shifts where id = s_next));

  -- ===== someone outside the organization (the helper used to say null) =====
  perform pg_temp.sw(x);
  msg := msg || pg_temp.ok('an outsider can''t see a worker', public.can_see_schedule(org, w1) = false);
  perform pg_temp.sw(w1);
  inc := public.report_incident(org, 'hazard', 'Loose railing');
  perform pg_temp.sw(x);
  txt := pg_temp.err(format('select public.resolve_incident(%L)', inc));
  perform pg_temp.su();
  msg := msg || pg_temp.ok('nor resolve a worker''s incident report',
    txt is not null and (select status from public.incident_reports where id = inc) = 'open');

  raise exception E'RESULT\n%', msg;
end $$;
