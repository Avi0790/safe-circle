-- Weather warnings on shift (migration ...000076). Rolls itself back; results
-- in the error text.
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
  m2 uuid := '00000000-0000-0000-0000-0000000000b2';  -- leads nobody
  w1 uuid := '00000000-0000-0000-0000-0000000000c1';
  w2 uuid := '00000000-0000-0000-0000-0000000000c2';  -- off shift
  org uuid; code text; ta uuid; r uuid; n int; txt text; ok boolean; q bigint; ex jsonb;
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
  ta := public.create_team(org, 'A');
  perform public.set_team_member(ta, m1, true); perform public.set_team_member(ta, w1, false);
  perform pg_temp.su();
  insert into public.shifts (org_id, user_id, clocked_in_at) values (org, w1, now() - interval '1 hour');

  -- ===== reporting =====
  perform pg_temp.sw(w2);
  ok := public.report_weather_risk('heat', 'caution', 95);
  perform pg_temp.su();
  msg := msg || pg_temp.ok('off shift: nothing is reported', ok = false and not exists (select 1 from public.shift_weather_alerts));

  select count(*) into q from net.http_request_queue;
  perform pg_temp.sw(w1);
  ok := public.report_weather_risk('heat', 'caution', 95);
  perform pg_temp.su();
  msg := msg || pg_temp.ok('on shift: recorded and their overseers pushed', ok
    and (select count(*) from public.shift_weather_alerts where user_id = w1) = 1
    and (select count(*) from net.http_request_queue) = q + 1);

  perform pg_temp.sw(w1);
  perform public.report_weather_risk('heat', 'caution', 97);
  perform pg_temp.su();
  msg := msg || pg_temp.ok('the same risk again this shift: no second push', (select count(*) from net.http_request_queue) = q + 1);
  perform pg_temp.sw(w1);
  perform public.report_weather_risk('heat', 'danger', 106);
  perform public.report_weather_risk('storm', 'danger');
  perform pg_temp.su();
  msg := msg || pg_temp.ok('a worse level, or another risk, does push', (select count(*) from net.http_request_queue) = q + 3);

  perform pg_temp.sw(w1);
  txt := pg_temp.err('select public.report_weather_risk(''flood'', ''danger'')');
  msg := msg || pg_temp.ok('only known risks', txt = 'Unknown weather risk.');
  txt := pg_temp.err('select public.report_weather_risk(''heat'', ''danger'', 400)');
  msg := msg || pg_temp.ok('and plausible numbers', txt = 'Implausible weather.');
  txt := pg_temp.err(format('insert into public.shift_weather_alerts (org_id, user_id, shift_id, kind, level) select %L, %L, id, %L, %L from public.shifts limit 1', org, w1, 'wind', 'caution'));
  msg := msg || pg_temp.ok('no writing directly', txt is not null);

  -- ===== who sees what =====
  perform pg_temp.sw(m1); select count(*) into n from public.org_weather_alerts(org);
  msg := msg || pg_temp.ok('the worker''s manager sees their warnings', n = 3);
  perform pg_temp.sw(o); select count(*) into n from public.shift_weather_alerts;
  msg := msg || pg_temp.ok('so does the owner', n = 3);
  perform pg_temp.sw(m2); select count(*) into n from public.org_weather_alerts(org);
  msg := msg || pg_temp.ok('a manager who doesn''t lead them doesn''t', n = 0);
  perform pg_temp.sw(w2); select count(*) into n from public.shift_weather_alerts;
  msg := msg || pg_temp.ok('nor does a coworker', n = 0);

  -- ===== your data =====
  perform pg_temp.sw(w1);
  ex := public.export_my_data();
  msg := msg || pg_temp.ok('in "Download my data", with everything before it',
    jsonb_array_length(ex -> 'weather_warnings_on_shift') = 3 and ex ? 'roll_call_answers' and ex ? 'profile');

  raise exception E'RESULT\n%', msg;
end $$;
