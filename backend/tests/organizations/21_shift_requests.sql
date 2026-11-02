-- Time off and shift requests (migration ...000077). Rolls itself back;
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
  m1 uuid := '00000000-0000-0000-0000-0000000000b1';  -- leads w1
  m2 uuid := '00000000-0000-0000-0000-0000000000b2';  -- leads w2
  w1 uuid := '00000000-0000-0000-0000-0000000000c1';
  w2 uuid := '00000000-0000-0000-0000-0000000000c2';
  org uuid; code text; ta uuid; tb uuid; r uuid;
  day1 timestamptz := date_trunc('day', now()) + interval '2 days';
  s1 uuid; s2 uuid; s3 uuid; req uuid; req2 uuid; off uuid; n int; txt text; st text; ex jsonb;
  msg text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (o, 'o@test.invalid', '{"full_name":"Olive"}'), (m1, 'm1@test.invalid', '{"full_name":"Max"}'),
    (m2, 'm2@test.invalid', '{"full_name":"Mia"}'), (w1, 'w1@test.invalid', '{"full_name":"Wendy"}'),
    (w2, 'w2@test.invalid', '{"full_name":"Walt"}');
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
  s1 := public.schedule_shift(org, w1, day1 + interval '7 hours', day1 + interval '15 hours');
  s2 := public.schedule_shift(org, w1, day1 + interval '1 day 7 hours', day1 + interval '1 day 15 hours');
  s3 := public.schedule_shift(org, w1, day1 + interval '5 days 7 hours', day1 + interval '5 days 15 hours');

  -- ===== "I can't make this shift" =====
  perform pg_temp.sw(w2);
  txt := pg_temp.err(format('select public.request_shift_drop(%L)', s1));
  msg := msg || pg_temp.ok('only for your own shift', txt = 'Shift not found.');
  perform pg_temp.sw(w1);
  req := public.request_shift_drop(s1, 'Dentist');
  txt := pg_temp.err(format('select public.request_shift_drop(%L)', s1));
  msg := msg || pg_temp.ok('one question per shift at a time', txt like 'You''ve already asked%');
  perform pg_temp.sw(m2);
  txt := pg_temp.err(format('select public.decide_shift_request(%L, true)', req));
  msg := msg || pg_temp.ok('another team''s manager can''t answer it', txt = 'Request not found.');
  perform pg_temp.sw(w1);
  txt := pg_temp.err(format('select public.decide_shift_request(%L, true)', req));
  msg := msg || pg_temp.ok('nor can the worker', txt = 'Request not found.');
  perform pg_temp.sw(m1);
  perform public.decide_shift_request(req, true);
  perform pg_temp.su();
  msg := msg || pg_temp.ok('their manager approves: the planned shift is gone',
    not exists (select 1 from public.scheduled_shifts where id = s1)
    and (select status from public.shift_requests where id = req) = 'approved');
  perform pg_temp.sw(m1);
  txt := pg_temp.err(format('select public.decide_shift_request(%L, false)', req));
  msg := msg || pg_temp.ok('and it can''t be answered twice', txt like 'That request has already%');

  perform pg_temp.sw(w1);
  req2 := public.request_shift_drop(s2);
  perform pg_temp.sw(o);
  perform public.decide_shift_request(req2, false);
  perform pg_temp.su();
  msg := msg || pg_temp.ok('declined: the shift stays', exists (select 1 from public.scheduled_shifts where id = s2));

  -- ===== time off =====
  perform pg_temp.sw(m1);
  txt := pg_temp.err(format('select public.request_time_off(%L, %L, %L)', org, day1, day1 + interval '1 day'));
  msg := msg || pg_temp.ok('time off is asked for by workers', txt = 'Only workers ask for time off.');
  perform pg_temp.sw(w1);
  txt := pg_temp.err(format('select public.request_time_off(%L, %L, %L)', org, day1, day1 + interval '90 days'));
  msg := msg || pg_temp.ok('at most 60 days at a time', txt like 'Ask for at most 60%');
  txt := pg_temp.err(format('select public.request_time_off(%L, %L, %L)', org, now() - interval '3 days', now() - interval '2 days'));
  msg := msg || pg_temp.ok('not for time already gone', txt = 'That time has already passed.');
  off := public.request_time_off(org, day1 + interval '1 day', day1 + interval '3 days', 'Family wedding');
  perform pg_temp.sw(w1);
  perform public.withdraw_shift_request(off);
  perform pg_temp.su();
  msg := msg || pg_temp.ok('a worker can withdraw their own', (select status from public.shift_requests where id = off) = 'withdrawn');
  perform pg_temp.sw(w1);
  off := public.request_time_off(org, day1 + interval '1 day', day1 + interval '3 days', 'Family wedding');
  perform pg_temp.sw(m1);
  perform public.decide_shift_request(off, true);
  perform pg_temp.su();
  msg := msg || pg_temp.ok('approved time off takes them off shifts in it, not others',
    not exists (select 1 from public.scheduled_shifts where id = s2) and exists (select 1 from public.scheduled_shifts where id = s3));
  perform pg_temp.sw(m1);
  txt := pg_temp.err(format('select public.schedule_shift(%L, %L, %L, %L)', org, w1, day1 + interval '2 days 7 hours', day1 + interval '2 days 15 hours'));
  msg := msg || pg_temp.ok('and nobody can plan them a shift there', txt = 'They have approved time off then.');

  -- ===== who sees what =====
  perform pg_temp.sw(m1); select count(*) into n from public.org_shift_requests(org);
  msg := msg || pg_temp.ok('their manager sees their requests', n = 4);
  perform pg_temp.sw(m2); select count(*) into n from public.org_shift_requests(org);
  msg := msg || pg_temp.ok('another team''s manager doesn''t', n = 0);
  perform pg_temp.sw(w2); select count(*) into n from public.shift_requests;
  msg := msg || pg_temp.ok('nor does a coworker', n = 0);
  perform pg_temp.sw(w1); select count(*) into n from public.org_shift_requests(org, true);
  msg := msg || pg_temp.ok('nothing pending is left', n = 0);
  txt := pg_temp.err(format('update public.shift_requests set status = %L where id = %L', 'approved', req2));
  perform pg_temp.su();
  msg := msg || pg_temp.ok('no approving your own by writing to the table', (select status from public.shift_requests where id = req2) = 'declined');

  perform pg_temp.sw(w1);
  ex := public.export_my_data();
  msg := msg || pg_temp.ok('in "Download my data", with everything before it',
    jsonb_array_length(ex -> 'time_off_and_shift_requests') = 4 and ex ? 'weather_warnings_on_shift' and ex ? 'profile');

  raise exception E'RESULT\n%', msg;
end $$;
