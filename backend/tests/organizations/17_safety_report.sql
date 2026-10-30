-- The safety report (migration ...000073). Rolls itself back; results in
-- the error text.
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
  m1 uuid := '00000000-0000-0000-0000-0000000000b1';
  w1 uuid := '00000000-0000-0000-0000-0000000000c1';
  w2 uuid := '00000000-0000-0000-0000-0000000000c2';
  x  uuid := '00000000-0000-0000-0000-0000000000d1';
  org uuid; code text; ta uuid; r uuid; sh1 bigint; e1 bigint; e2 bigint;
  rec record; n int; txt text; ev int;
  msg text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (o, 'o@test.invalid', '{"full_name":"Olive"}'), (m1, 'm1@test.invalid', '{"full_name":"Max"}'),
    (w1, 'w1@test.invalid', '{"full_name":"Wendy"}'), (w2, 'w2@test.invalid', '{"full_name":"Walt"}'),
    (x, 'x@test.invalid', '{"full_name":"Out"}');
  perform pg_temp.sw(o);
  select c.org_id, c.invite_code into org, code from public.create_organization('Crew') c;
  foreach r in array array[m1, w1, w2] loop
    perform pg_temp.sw(r); perform public.redeem_org_invite_code(code); perform public.accept_org_consent(org);
  end loop;
  perform pg_temp.sw(o);
  perform public.set_org_member_role(org, m1, 'manager');
  ta := public.create_team(org, 'A');
  perform public.set_team_member(ta, m1, true); perform public.set_team_member(ta, w1, false);
  perform pg_temp.su();

  -- this week: w1 works 8 h and sends an SOS answered after 4 minutes; w2
  -- works 6 h and their SOS goes unanswered
  insert into public.shifts (org_id, user_id, clocked_in_at, clocked_out_at)
  values (org, w1, now() - interval '9 hours', now() - interval '1 hour') returning id into sh1;
  insert into public.shifts (org_id, user_id, clocked_in_at, clocked_out_at)
  values (org, w2, now() - interval '7 hours', now() - interval '1 hour');
  insert into public.sos_events (user_id, latitude, longitude, created_at)
  values (w1, 1, 1, now() - interval '5 hours') returning id into e1;
  insert into public.sos_acknowledgements (sos_event_id, user_id, created_at) values (e1, m1, now() - interval '5 hours' + interval '4 minutes');
  insert into public.sos_events (user_id, latitude, longitude, created_at)
  values (w2, 1, 1, now() - interval '4 hours') returning id into e2;
  -- an SOS off shift isn't work's business
  insert into public.sos_events (user_id, latitude, longitude, created_at) values (w1, 1, 1, now() - interval '20 minutes');

  -- the flags the scheduled jobs raise are logged as they're raised
  update public.shifts set checkin_alerted_at = now() - interval '6 hours' where id = sh1;
  update public.shifts set quiet_alerted_at = now() - interval '3 hours' where id = sh1;
  update public.shifts set quiet_alerted_at = null where id = sh1;            -- they answered
  update public.shifts set quiet_alerted_at = now() - interval '2 hours' where id = sh1;  -- quiet again
  select count(*) into ev from public.org_safety_events where org_id = org;
  msg := msg || pg_temp.ok('each missed check-in and quiet spell is logged once, even after the flag is cleared', ev = 3);

  -- ===== the owner's report =====
  perform pg_temp.sw(o);
  -- totals over the report, so a test run early on a Monday (when some of
  -- these fall in last week) still adds up
  select sum(hours) as hours, sum(shifts) as shifts, sum(workers) as workers, sum(sos) as sos,
         sum(sos_answered) as sos_answered, max(median_response_minutes) as median_response_minutes,
         sum(missed_checkins) as missed_checkins, sum(quiet_phones) as quiet_phones
    into rec from public.org_safety_report(org, 4);
  select count(*) into n from public.org_safety_report(org, 4);
  perform pg_temp.su();
  msg := msg || pg_temp.ok('four weeks, oldest first, this week last', n = 4);
  msg := msg || pg_temp.ok('hours and shifts (14 h, 2 shifts, 2 workers)', rec.hours = 14 and rec.shifts = 2 and rec.workers = 2);
  msg := msg || pg_temp.ok('two SOS on shift, one answered, the off-shift one not counted', rec.sos = 2 and rec.sos_answered = 1);
  msg := msg || pg_temp.ok('median time to answer: 4 minutes', rec.median_response_minutes = 4);
  msg := msg || pg_temp.ok('one missed check-in, two quiet spells', rec.missed_checkins = 1 and rec.quiet_phones = 2);

  -- ===== the manager sees only their team =====
  perform pg_temp.sw(m1);
  select sum(hours) as hours, sum(shifts) as shifts, sum(sos) as sos into rec from public.org_safety_report(org, 4);
  perform pg_temp.su();
  msg := msg || pg_temp.ok('the manager''s report covers only their team (Wendy''s 8 h, one SOS)', rec.hours = 8 and rec.shifts = 1 and rec.sos = 1);

  -- ===== nobody else =====
  perform pg_temp.sw(w1);
  txt := pg_temp.err(format('select * from public.org_safety_report(%L)', org));
  msg := msg || pg_temp.ok('a worker can''t see the report', txt like 'Only owners%');
  perform pg_temp.sw(x);
  txt := pg_temp.err(format('select * from public.org_safety_report(%L)', org));
  msg := msg || pg_temp.ok('an outsider can''t either', txt like 'Only owners%');
  select count(*) into n from public.org_safety_events;
  perform pg_temp.su();
  msg := msg || pg_temp.ok('the event log isn''t readable directly', n = 0);

  perform pg_temp.sw(o);
  select count(*) into n from public.org_safety_report(org, 100, 'Not/AZone');
  perform pg_temp.su();
  msg := msg || pg_temp.ok('at most 26 weeks, and an unknown time zone falls back to UTC', n = 26);

  raise exception E'RESULT\n%', msg;
end $$;
