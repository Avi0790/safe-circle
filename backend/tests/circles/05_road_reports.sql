-- Road incident reports (migration ...000061). Self-rolling-back: run with
-- `supabase db query --linked -f tests/circles/05_road_reports.sql`; the
-- RESULT lines are printed by the final raise.
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
do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000a1';
  b uuid := '00000000-0000-0000-0000-0000000000b1';
  c uuid := '00000000-0000-0000-0000-0000000000c1';
  d uuid := '00000000-0000-0000-0000-0000000000d1';
  circ uuid; code text; r uuid; r1 uuid; r2 uuid; r3 uuid; n int; ok boolean; exp_at timestamptz;
  msg text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (a,'a@test.invalid','{"full_name":"A Reporter"}'), (b,'b@test.invalid','{"full_name":"B Mate"}'),
    (c,'c@test.invalid','{"full_name":"C Hidden"}'), (d,'d@test.invalid','{"full_name":"D Outsider"}');
  perform pg_temp.sw(a);
  select x.circle_id, x.invite_code into circ, code from public.create_circle('Family') x;
  foreach r in array array[b, c] loop
    perform pg_temp.sw(r); perform public.redeem_invite_code(code);
  end loop;
  perform pg_temp.sw(d); perform public.create_circle('Other');
  perform pg_temp.sw(a);
  perform public.hide_from(c);

  -- ===== who sees a report =====
  r1 := public.report_road_incident('crash', 35.8423, -90.7043);
  select count(*) into n from public.road_reports where id = r1;
  msg := msg || pg_temp.ok('the reporter sees their report', n = 1);
  perform pg_temp.sw(b); select count(*) into n from public.road_reports where id = r1;
  msg := msg || pg_temp.ok('a circle-mate sees it', n = 1);
  perform pg_temp.sw(c); select count(*) into n from public.road_reports where id = r1;
  msg := msg || pg_temp.ok('someone hidden from (Ghost mode) does not: it says where you were', n = 0);
  perform pg_temp.sw(d); select count(*) into n from public.road_reports where id = r1;
  msg := msg || pg_temp.ok('an outsider does not', n = 0);
  perform pg_temp.su();
  select expires_at into exp_at from public.road_reports where id = r1;
  msg := msg || pg_temp.ok('a crash report lasts an hour', exp_at between now() + interval '59 minutes' and now() + interval '61 minutes');

  -- ===== a double tap refreshes, it doesn't stack =====
  perform pg_temp.sw(a);
  r2 := public.report_road_incident('crash', 35.8425, -90.7044);   -- ~25 m away
  select count(*) into n from public.road_reports where reporter_id = a;
  msg := msg || pg_temp.ok('the same thing reported twice nearby is one report', r2 = r1 and n = 1);
  r2 := public.report_road_incident('hazard', 35.8423, -90.7043);
  msg := msg || pg_temp.ok('a different kind at the same spot is its own report', r2 <> r1);
  r3 := public.report_road_incident('crash', 35.8600, -90.7043);   -- ~2 km away
  msg := msg || pg_temp.ok('the same kind far away is its own report', r3 <> r1);
  r3 := public.report_road_incident('closure', 35.8700, -90.7043);
  perform pg_temp.su();
  select expires_at into exp_at from public.road_reports where id = r3;
  msg := msg || pg_temp.ok('a closed road lasts three hours', exp_at between now() + interval '179 minutes' and now() + interval '181 minutes');

  -- ===== rate limit =====
  perform pg_temp.sw(a);
  perform public.report_road_incident('speed_check', 35.8800, -90.7043);   -- the 5th
  begin
    perform public.report_road_incident('hazard', 35.9000, -90.7043);
    msg := msg || pg_temp.ok('a 6th report within 10 minutes is refused', false);
  exception when others then msg := msg || pg_temp.ok('a 6th report within 10 minutes is refused', sqlerrm like '%a lot of reports%'); end;
  ok := true;
  begin perform public.report_road_incident('crash', 35.8423, -90.7043); exception when others then ok := false; end;
  msg := msg || pg_temp.ok('...but repeating an existing one still just refreshes it', ok);

  -- ===== validation and tampering =====
  perform pg_temp.sw(b);
  begin perform public.report_road_incident('pothole', 35, -90); msg := msg || pg_temp.ok('an unknown kind is refused', false);
  exception when others then msg := msg || pg_temp.ok('an unknown kind is refused', sqlerrm like 'Choose crash%'); end;
  begin perform public.report_road_incident('crash', 95, -90); msg := msg || pg_temp.ok('an impossible location is refused', false);
  exception when others then msg := msg || pg_temp.ok('an impossible location is refused', true); end;
  begin
    insert into public.road_reports (reporter_id, kind, latitude, longitude, expires_at) values (b, 'crash', 35, -90, now() + interval '1 day');
    msg := msg || pg_temp.ok('cannot insert reports directly (or pick your own expiry)', false);
  exception when others then msg := msg || pg_temp.ok('cannot insert reports directly (or pick your own expiry)', true); end;
  begin update public.road_reports set expires_at = now() + interval '10 days' where id = r1; exception when others then null; end;
  perform public.clear_road_report(r1);
  perform pg_temp.su();
  select count(*) into n from public.road_reports where id = r1 and expires_at < now() + interval '2 hours';
  msg := msg || pg_temp.ok('a circle-mate cannot extend or clear someone else''s report', n = 1);
  perform pg_temp.sw(a);
  begin update public.road_reports set expires_at = now() + interval '10 days' where id = r1; exception when others then null; end;
  perform pg_temp.su();
  select count(*) into n from public.road_reports where id = r1 and expires_at < now() + interval '2 hours';
  msg := msg || pg_temp.ok('the reporter cannot stretch it either', n = 1);
  perform pg_temp.sw(a);
  perform public.clear_road_report(r1);
  perform pg_temp.su();
  select count(*) into n from public.road_reports where id = r1;
  msg := msg || pg_temp.ok('the reporter can take their report back', n = 0);

  -- ===== sharing window ended, and expiry =====
  update public.profiles set share_until = now() - interval '1 minute' where id = a;
  perform pg_temp.sw(b); select count(*) into n from public.road_reports where reporter_id = a;
  msg := msg || pg_temp.ok('once the reporter''s sharing window ends, circle-mates see none of their reports', n = 0);
  perform pg_temp.su();
  update public.profiles set share_until = null where id = a;
  update public.road_reports set expires_at = now() - interval '1 minute' where id = r2;
  perform pg_temp.sw(a); select count(*) into n from public.road_reports where id = r2;
  msg := msg || pg_temp.ok('an expired report is gone from view, even for the reporter', n = 0);
  perform pg_temp.su();
  update public.road_reports set expires_at = now() - interval '25 hours' where id = r2;
  perform public.purge_road_reports();
  select count(*) into n from public.road_reports where id = r2;
  msg := msg || pg_temp.ok('expired reports are deleted after a day', n = 0);

  -- ===== function surface =====
  msg := msg || pg_temp.ok('signed-in users can report and clear',
    has_function_privilege('authenticated', 'public.report_road_incident(text,double precision,double precision)', 'execute')
    and has_function_privilege('authenticated', 'public.clear_road_report(uuid)', 'execute'));
  msg := msg || pg_temp.ok('anonymous callers cannot report',
    not has_function_privilege('anon', 'public.report_road_incident(text,double precision,double precision)', 'execute'));
  msg := msg || pg_temp.ok('the purge job is not callable from the API',
    not has_function_privilege('authenticated', 'public.purge_road_reports()', 'execute')
    and not has_function_privilege('anon', 'public.purge_road_reports()', 'execute'));
  select count(*) into n from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'road_reports';
  msg := msg || pg_temp.ok('reports arrive live (realtime)', n = 1);

  perform pg_temp.su();
  raise exception E'RESULT\n%', msg;
end $$;
