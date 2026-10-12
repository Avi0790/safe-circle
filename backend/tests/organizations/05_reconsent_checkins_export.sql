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
create function pg_temp.pushed(since bigint, prefix text) returns text language sql as $$
  select coalesce(string_agg(
           (select string_agg(p.full_name, ',' order by p.full_name)
              from jsonb_array_elements_text(j.body -> 'recipient_ids') r
              join public.profiles p on p.id = r::uuid), ' | '), '(none)')
  from (
    select (case when pg_typeof(q.body)::text = 'bytea' then convert_from(q.body::bytea, 'utf8') else q.body::text end)::jsonb as body
    from net.http_request_queue q
    where q.id > since and q.url like '%send-alert-push%'
  ) j
  where j.body ->> 'title' like prefix || '%'
$$;

do $$
declare
  o  uuid := '00000000-0000-0000-0000-0000000000a0';
  ad uuid := '00000000-0000-0000-0000-0000000000a1';
  m1 uuid := '00000000-0000-0000-0000-0000000000b1';
  w1 uuid := '00000000-0000-0000-0000-0000000000c1';
  w2 uuid := '00000000-0000-0000-0000-0000000000c2';
  w3 uuid := '00000000-0000-0000-0000-0000000000c3';
  org uuid; code text; team uuid; r uuid;
  q bigint; n int; n2 int; txt text; b boolean; due timestamptz; sosid bigint; exp jsonb;
  t timestamptz := now(); msg text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (o,'o@test.invalid','{"full_name":"A Owner"}'), (ad,'ad@test.invalid','{"full_name":"B Admin"}'),
    (m1,'m1@test.invalid','{"full_name":"C Lead"}'), (w1,'w1@test.invalid','{"full_name":"E Worker"}'),
    (w2,'w2@test.invalid','{"full_name":"F Checker"}'), (w3,'w3@test.invalid','{"full_name":"G Nopings"}');

  perform pg_temp.sw(o);
  select c.org_id, c.invite_code into org, code from public.create_organization('Crew') c;
  foreach r in array array[ad, m1, w1, w2, w3] loop
    perform pg_temp.sw(r);
    perform public.redeem_org_invite_code(code);
    perform public.accept_org_consent(org);
  end loop;
  perform pg_temp.sw(o);
  perform public.set_org_member_role(org, ad, 'admin');
  perform public.set_org_member_role(org, m1, 'manager');
  team := public.create_team(org, 'A');
  perform public.set_team_member(team, m1, true);
  perform public.set_team_member(team, w1, false);

  -- ===== RE-CONSENT =====
  perform pg_temp.sw(w1);
  perform public.clock_in(org);
  perform pg_temp.sw(ad);
  select count(*) into n from public.org_live_roster(org);
  msg := msg || pg_temp.ok('baseline: consented worker on shift is visible to admin', n = 1);

  -- the disclosure "changes": w1's consent is now to an older version
  perform pg_temp.su();
  update public.org_members set consent_version = 1 where user_id = w1;

  perform pg_temp.sw(w1);
  select needs_reconsent into b from public.my_orgs();
  msg := msg || pg_temp.ok('worker is told to re-accept (needs_reconsent)', b);
  perform pg_temp.sw(ad);
  select count(*) into n from public.org_live_roster(org);
  msg := msg || pg_temp.ok('an open shift is no longer visible until they re-accept', n = 0);
  select status into txt from public.org_roster(org) where user_id = w1;
  msg := msg || pg_temp.ok('roster shows them as waiting to accept', txt = 'invited');
  perform pg_temp.sw(m1);
  select count(*) into n from public.org_live_roster(org);
  msg := msg || pg_temp.ok('their lead manager cannot see them either', n = 0);
  perform pg_temp.su();
  msg := msg || pg_temp.ok('their SOS would reach nobody at work', cardinality(public.sos_org_recipients(w1, now())) = 0);
  perform pg_temp.sw(w1);
  perform public.clock_out();
  begin
    perform public.clock_in(org);
    msg := msg || 'FAIL clocked in without accepting the new disclosure' || E'\n';
  exception when others then msg := msg || 'PASS cannot clock in until the new disclosure is accepted' || E'\n'; end;
  perform public.accept_org_consent(org);
  select needs_reconsent into b from public.my_orgs();
  msg := msg || pg_temp.ok('accepting clears needs_reconsent', b = false);
  perform public.clock_in(org);
  perform pg_temp.sw(ad);
  select count(*) into n from public.org_live_roster(org);
  msg := msg || pg_temp.ok('after re-accepting they are visible again', n = 1);
  perform pg_temp.sw(w1);
  begin
    perform public.accept_org_consent(org);
    msg := msg || 'FAIL accepted twice' || E'\n';
  exception when others then msg := msg || 'PASS nothing to accept when already current' || E'\n'; end;
  perform pg_temp.su();
  select count(*) into n from public.org_audit where action = 'reconsented' and target_id = w1;
  msg := msg || pg_temp.ok('re-acceptance is logged', n = 1);

  -- ===== CHECK-INS =====
  perform pg_temp.sw(w2);
  begin
    perform public.clock_in(org, 10);
    msg := msg || 'FAIL a 10 minute check-in interval was allowed' || E'\n';
  exception when others then msg := msg || 'PASS check-in interval below 15 minutes refused' || E'\n'; end;
  perform public.clock_in(org, 30);
  select checkin_minutes, next_checkin_due into n, due from public.my_orgs();
  msg := msg || pg_temp.ok('my_orgs reports the schedule (30 min, due in the future)', n = 30 and due > now());
  perform pg_temp.sw(w1);
  begin
    perform public.shift_check_in();
    msg := msg || 'FAIL checked in on a shift with no check-ins' || E'\n';
  exception when others then msg := msg || 'PASS cannot check in when none are scheduled' || E'\n'; end;

  perform pg_temp.su();
  select public.escalate_missed_checkins() into n;
  msg := msg || pg_temp.ok('nothing alerts before a check-in is overdue', n = 0);

  -- w2 misses their check-in (and has a position on shift)
  update public.shifts set next_checkin_due = now() - interval '10 minutes' where user_id = w2 and clocked_out_at is null;
  insert into public.locations (user_id, latitude, longitude, speed, recorded_at) values (w2, 7, 7, 0, now());
  select coalesce(max(id), 0) into q from net.http_request_queue;
  select public.escalate_missed_checkins() into n;
  msg := msg || pg_temp.ok('a missed check-in raises one alert', n = 1);
  select id into sosid from public.sos_events where user_id = w2 and message like '%missed a scheduled check-in%';
  msg := msg || pg_temp.ok('...as an SOS at their last on-shift location', sosid is not null);
  txt := pg_temp.pushed(q, '🆘 SOS');
  msg := msg || pg_temp.ok('...that alerts owner and admin [' || txt || ']', txt = 'A Owner,B Admin');
  select public.escalate_missed_checkins() into n;
  msg := msg || pg_temp.ok('the same missed check-in does not alert twice', n = 0);
  perform pg_temp.sw(ad);
  select count(*) into n from public.sos_events where id = sosid;
  msg := msg || pg_temp.ok('admin can see and respond to it', n = 1);
  perform pg_temp.sw(m1);
  select count(*) into n from public.sos_events where id = sosid;
  msg := msg || pg_temp.ok('a manager who does not lead their team cannot', n = 0);

  -- "I'm OK"
  perform pg_temp.su();
  select coalesce(max(id), 0) into q from net.http_request_queue;
  perform pg_temp.sw(w2);
  due := public.shift_check_in();
  msg := msg || pg_temp.ok('"I''m OK" starts the next interval', due > now() + interval '29 minutes');
  perform pg_temp.su();
  select resolved_at is not null into b from public.sos_events where id = sosid;
  msg := msg || pg_temp.ok('...and resolves the alert', b);
  txt := pg_temp.pushed(q, '✅');
  msg := msg || pg_temp.ok('...and tells the overseers [' || txt || ']', txt = 'A Owner,B Admin');
  select checkin_alerted_at is null and checkin_sos_id is null into b from public.shifts where user_id = w2 and clocked_out_at is null;
  msg := msg || pg_temp.ok('...and re-arms the next check-in', b);

  -- a missed check-in with no location still alerts, by push
  perform pg_temp.sw(w3);
  perform public.clock_in(org, 15);
  perform pg_temp.su();
  update public.shifts set next_checkin_due = now() - interval '5 minutes' where user_id = w3 and clocked_out_at is null;
  select coalesce(max(id), 0) into q from net.http_request_queue;
  select public.escalate_missed_checkins() into n;
  msg := msg || pg_temp.ok('a missed check-in with no location still alerts', n = 1);
  txt := pg_temp.pushed(q, '⏱️ Missed check-in');
  msg := msg || pg_temp.ok('...by plain push to owner and admin [' || txt || ']', txt = 'A Owner,B Admin');
  select count(*) into n from public.sos_events where user_id = w3;
  msg := msg || pg_temp.ok('...without inventing a location', n = 0);

  -- a worker who has clocked out is never alerted about
  perform pg_temp.sw(w2);
  perform public.clock_out();
  perform pg_temp.su();
  update public.shifts set next_checkin_due = now() - interval '1 hour', checkin_alerted_at = null where user_id = w2;
  select public.escalate_missed_checkins() into n;
  msg := msg || pg_temp.ok('a finished shift is never alerted about', n = 0);

  -- ===== EXPORT =====
  perform pg_temp.sw(w1);
  exp := public.export_my_data();
  msg := msg || pg_temp.ok('export still has the existing sections', (exp -> 'profile') is not null and (exp -> 'locations') is not null and (exp -> 'circles') is not null);
  msg := msg || pg_temp.ok('export lists the organization, role and accepted version',
    jsonb_array_length(exp -> 'organizations') = 1
    and exp -> 'organizations' -> 0 ->> 'organization' = 'Crew'
    and exp -> 'organizations' -> 0 ->> 'role' = 'worker'
    and (exp -> 'organizations' -> 0 ->> 'consented_to_disclosure_version')::int = public.org_disclosure_version()
    and jsonb_array_length(exp -> 'organizations' -> 0 -> 'teams') = 1);
  msg := msg || pg_temp.ok('export lists the worker''s shifts', jsonb_array_length(exp -> 'work_shifts') >= 1);
  msg := msg || pg_temp.ok('export lists who looked at them at work',
    jsonb_array_length(exp -> 'who_looked_at_you_at_work') >= 1
    and exp -> 'who_looked_at_you_at_work' -> 0 ->> 'viewer' is not null);
  perform pg_temp.su();
  raise exception E'RESULT\n%', msg;
end $$;
