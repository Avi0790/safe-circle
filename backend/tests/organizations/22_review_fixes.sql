-- The security review fixes (migration ...000078). Rolls itself back;
-- results in the error text.
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
  w1 uuid := '00000000-0000-0000-0000-0000000000c1';
  org uuid; code text; rc uuid; s1 uuid; req uuid; i int; txt text; lat double precision;
  msg text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (o, 'o@test.invalid', '{"full_name":"Olive"}'), (w1, 'w1@test.invalid', '{"full_name":"Wendy"}');
  perform pg_temp.sw(o);
  select c.org_id, c.invite_code into org, code from public.create_organization('Crew') c;
  perform pg_temp.sw(w1); perform public.redeem_org_invite_code(code); perform public.accept_org_consent(org);
  perform pg_temp.su();
  insert into public.shifts (org_id, user_id, clocked_in_at) values (org, w1, now() - interval '1 hour');

  -- 1. no position once off shift
  perform pg_temp.sw(o);
  rc := public.start_roll_call(org);
  perform pg_temp.su();
  update public.shifts set clocked_out_at = now() where user_id = w1;
  perform pg_temp.sw(w1);
  perform public.answer_roll_call(rc, 'safe', 35.84, -90.70);
  perform pg_temp.su();
  select latitude into lat from public.org_roll_call_members where roll_call_id = rc and user_id = w1;
  msg := msg || pg_temp.ok('a worker who has clocked out answers without their position',
    lat is null and (select answer from public.org_roll_call_members where roll_call_id = rc and user_id = w1) = 'safe');
  insert into public.shifts (org_id, user_id, clocked_in_at) values (org, w1, now() - interval '5 minutes');
  perform pg_temp.sw(w1);
  perform public.answer_roll_call(rc, 'safe', 35.84, -90.70);
  perform pg_temp.su();
  select latitude into lat from public.org_roll_call_members where roll_call_id = rc and user_id = w1;
  msg := msg || pg_temp.ok('on shift, the position goes with it', lat = 35.84);

  -- 2. six roll calls an hour
  perform pg_temp.sw(o);
  perform public.close_roll_call(rc);
  for i in 1..5 loop
    rc := public.start_roll_call(org);
    perform public.close_roll_call(rc);
  end loop;
  txt := pg_temp.err(format('select public.start_roll_call(%L)', org));
  msg := msg || pg_temp.ok('a seventh roll call within the hour is refused', txt like 'That''s six roll calls this hour%');

  -- 3. weather numbers
  perform pg_temp.sw(w1);
  txt := pg_temp.err('select public.report_weather_risk(''heat'', ''danger'')');
  msg := msg || pg_temp.ok('heat without a temperature is refused', txt = 'Implausible weather.');
  txt := pg_temp.err('select public.report_weather_risk(''wind'', ''caution'', 50)');
  msg := msg || pg_temp.ok('wind without a gust speed is refused', txt = 'Implausible weather.');
  msg := msg || pg_temp.ok('a storm needs neither', public.report_weather_risk('storm', 'danger') = true);

  -- 4. ten waiting requests
  for i in 1..10 loop
    perform public.request_time_off(org, now() + make_interval(days => i * 3), now() + make_interval(days => i * 3 + 1));
  end loop;
  txt := pg_temp.err(format('select public.request_time_off(%L, %L, %L)', org, now() + interval '40 days', now() + interval '41 days'));
  msg := msg || pg_temp.ok('an eleventh waiting request is refused', txt like 'You have 10 requests waiting%');

  -- 5. and 6. a started shift stays on the record
  perform pg_temp.sw(o);
  s1 := public.schedule_shift(org, w1, now() + interval '2 hours', now() + interval '10 hours');
  perform pg_temp.sw(w1);
  req := public.request_shift_drop(s1);
  perform pg_temp.su();
  update public.scheduled_shifts set starts_at = now() - interval '1 hour', ends_at = now() + interval '7 hours' where id = s1;
  update public.shift_requests set starts_at = now() - interval '1 hour' where id = req;
  perform pg_temp.sw(o);
  txt := pg_temp.err(format('select public.decide_shift_request(%L, true)', req));
  msg := msg || pg_temp.ok('"can''t make it" can''t be approved once the shift started', txt = 'That shift has already started.');
  txt := pg_temp.err(format('select public.cancel_scheduled_shift(%L)', s1));
  msg := msg || pg_temp.ok('nor can a started shift be cancelled', txt = 'That shift has already started.');
  perform pg_temp.su();
  msg := msg || pg_temp.ok('it''s still there', exists (select 1 from public.scheduled_shifts where id = s1));

  raise exception E'RESULT\n%', msg;
end $$;
