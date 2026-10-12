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
              join public.profiles p on p.id = r::uuid), ' | ' order by j.body ->> 'title'), '(none)')
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
  m2 uuid := '00000000-0000-0000-0000-0000000000b2';
  w1 uuid := '00000000-0000-0000-0000-0000000000c1';
  w2 uuid := '00000000-0000-0000-0000-0000000000c2';
  w3 uuid := '00000000-0000-0000-0000-0000000000c3';
  w4 uuid := '00000000-0000-0000-0000-0000000000c4';
  org uuid; code text; team uuid; r uuid; q bigint; n int; txt text; b boolean;
  t timestamptz := now(); msg text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (o,'o@test.invalid','{"full_name":"A Owner"}'), (ad,'ad@test.invalid','{"full_name":"B Admin"}'),
    (m1,'m1@test.invalid','{"full_name":"C Lead"}'), (m2,'m2@test.invalid','{"full_name":"D Other"}'),
    (w1,'w1@test.invalid','{"full_name":"E Quiet"}'), (w2,'w2@test.invalid','{"full_name":"F Active"}'),
    (w3,'w3@test.invalid','{"full_name":"G Neverping"}'), (w4,'w4@test.invalid','{"full_name":"H Fresh"}');

  perform pg_temp.sw(o);
  select c.org_id, c.invite_code into org, code from public.create_organization('Crew') c;
  foreach r in array array[ad, m1, m2, w1, w2, w3, w4] loop
    perform pg_temp.sw(r); perform public.redeem_org_invite_code(code); perform public.accept_org_consent(org);
  end loop;
  perform pg_temp.sw(o);
  perform public.set_org_member_role(org, ad, 'admin');
  perform public.set_org_member_role(org, m1, 'manager');
  perform public.set_org_member_role(org, m2, 'manager');
  team := public.create_team(org, 'A');
  perform public.set_team_member(team, m1, true);
  perform public.set_team_member(team, w1, false);

  perform pg_temp.su();
  -- w1: on shift 2h, last ping 25 min ago          -> quiet
  -- w2: on shift 2h, last ping 5 min ago           -> fine
  -- w3: on shift 30 min, never pinged              -> quiet since clock-in
  -- w4: on shift 10 min, never pinged              -> too soon
  insert into public.shifts (org_id, user_id, clocked_in_at) values
    (org, w1, t - interval '2 hours'), (org, w2, t - interval '2 hours'),
    (org, w3, t - interval '30 minutes'), (org, w4, t - interval '10 minutes');
  insert into public.locations (user_id, latitude, longitude, recorded_at) values
    (w1, 1, 1, t - interval '25 minutes'), (w2, 2, 2, t - interval '5 minutes');

  select coalesce(max(id), 0) into q from net.http_request_queue;
  select public.alert_quiet_phones() into n;
  msg := msg || pg_temp.ok('two phones are quiet: one with a stale ping, one that never reported (' || n || ')', n = 2);
  txt := pg_temp.pushed(q, '📵');
  msg := msg || pg_temp.ok('alerts go to the right overseers per worker [' || txt || ']',
    txt = 'A Owner,B Admin,C Lead | A Owner,B Admin');
  -- ordered by title: E Quiet is on the lead manager's team (owner, admin, lead); G Neverping has no team (owner, admin)

  select coalesce(max(id), 0) into q from net.http_request_queue;
  select public.alert_quiet_phones() into n;
  msg := msg || pg_temp.ok('the same quiet stretch is not alerted twice', n = 0 and pg_temp.pushed(q, '📵') = '(none)');

  -- the phone comes back, then goes quiet again later
  insert into public.locations (user_id, latitude, longitude, recorded_at) values (w1, 3, 3, now() + interval '1 second');
  select public.alert_quiet_phones() into n;
  select quiet_alerted_at is null into b from public.shifts where user_id = w1;
  msg := msg || pg_temp.ok('a new ping ends the stretch (flag cleared) without a new alert', b and n = 0);
  update public.locations set recorded_at = t - interval '40 minutes' where user_id = w1 and latitude = 3;
  update public.locations set recorded_at = t - interval '41 minutes' where user_id = w1 and latitude = 1;
  select coalesce(max(id), 0) into q from net.http_request_queue;
  select public.alert_quiet_phones() into n;
  msg := msg || pg_temp.ok('going quiet again later alerts again [' || pg_temp.pushed(q, '📵') || ']',
    n = 1 and pg_temp.pushed(q, '📵') = 'A Owner,B Admin,C Lead');

  -- exclusions
  update public.shifts set quiet_alerted_at = null;
  update public.shifts set clocked_out_at = now() where user_id = w1;
  update public.shifts set clocked_in_at = t - interval '15 hours' where user_id = w3;
  select coalesce(max(id), 0) into q from net.http_request_queue;
  select public.alert_quiet_phones() into n;
  msg := msg || pg_temp.ok('a finished shift and a 14h-stale shift are never alerted about', n = 0);

  -- a worker who must re-accept the disclosure has no overseers to tell
  update public.shifts set clocked_in_at = t - interval '40 minutes', quiet_alerted_at = null where user_id = w3;
  update public.org_members set consent_version = 1 where user_id = w3;
  select coalesce(max(id), 0) into q from net.http_request_queue;
  select public.alert_quiet_phones() into n;
  msg := msg || pg_temp.ok('a worker pending re-consent alerts nobody', pg_temp.pushed(q, '📵') = '(none)');

  -- callers
  perform pg_temp.sw(w2);
  begin perform public.alert_quiet_phones(); msg := msg || 'FAIL a signed-in user ran the quiet sweep' || E'\n';
  exception when others then msg := msg || 'PASS a signed-in user cannot run the quiet sweep' || E'\n'; end;

  -- the version bump asks workers to accept again
  perform pg_temp.su();
  msg := msg || pg_temp.ok('disclosure is now version 3', public.org_disclosure_version() = 3);

  raise exception E'RESULT\n%', msg;
end $$;
