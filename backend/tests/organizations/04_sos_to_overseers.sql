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

-- Names of everyone a queued alert push was addressed to, for pushes added
-- after queue id `since` whose title starts with `prefix`.
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
  m2 uuid := '00000000-0000-0000-0000-0000000000b2';
  w1 uuid := '00000000-0000-0000-0000-0000000000c1';
  w2 uuid := '00000000-0000-0000-0000-0000000000c2';
  x  uuid := '00000000-0000-0000-0000-0000000000d1';
  cm uuid := '00000000-0000-0000-0000-0000000000d2';
  org uuid; code text; team1 uuid; team2 uuid; circ uuid; ccode text; r uuid;
  e1 bigint; e2 bigint; e3 bigint; e4 bigint; e5 bigint;
  q bigint; n int; n2 int; got text; t timestamptz := now(); msg text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (o,'o@test.invalid','{"full_name":"A Owner"}'), (ad,'ad@test.invalid','{"full_name":"B Admin"}'),
    (m1,'m1@test.invalid','{"full_name":"C Lead"}'), (m2,'m2@test.invalid','{"full_name":"D Other"}'),
    (w1,'w1@test.invalid','{"full_name":"E Worker"}'), (w2,'w2@test.invalid','{"full_name":"F Loner"}'),
    (x,'x@test.invalid','{"full_name":"G Outsider"}'), (cm,'cm@test.invalid','{"full_name":"H Family"}');

  perform pg_temp.sw(o);
  select c.org_id, c.invite_code into org, code from public.create_organization('Crew') c;
  foreach r in array array[ad, m1, m2, w1, w2] loop
    perform pg_temp.sw(r);
    perform public.redeem_org_invite_code(code);
    perform public.accept_org_consent(org);
  end loop;
  perform pg_temp.sw(o);
  perform public.set_org_member_role(org, ad, 'admin');
  perform public.set_org_member_role(org, m1, 'manager');
  perform public.set_org_member_role(org, m2, 'manager');
  team1 := public.create_team(org, 'A'); team2 := public.create_team(org, 'B');
  perform public.set_team_member(team1, m1, true);
  perform public.set_team_member(team1, w1, false);
  perform public.set_team_member(team2, m2, true);

  -- both workers have been clocked in for 2 hours
  perform pg_temp.su();
  insert into public.shifts (org_id, user_id, clocked_in_at) values (org, w1, t - interval '2 hours'), (org, w2, t - interval '2 hours');
  select coalesce(max(id), 0) into q from net.http_request_queue;

  -- E1: w1 SOS while on shift (30 min ago)
  insert into public.sos_events (user_id, latitude, longitude, created_at) values (w1, 1, 1, t - interval '30 minutes') returning id into e1;
  got := pg_temp.pushed(q, '🆘 SOS');
  msg := msg || pg_temp.ok('on-shift SOS alerts owner, admin and the LEAD manager only [' || got || ']', got = 'A Owner,B Admin,C Lead');

  -- E2: w1 SOS before the shift started (off shift): no organization alert
  select coalesce(max(id), 0) into q from net.http_request_queue;
  insert into public.sos_events (user_id, latitude, longitude, created_at) values (w1, 2, 2, t - interval '5 hours') returning id into e2;
  msg := msg || pg_temp.ok('off-shift SOS alerts nobody at work [' || pg_temp.pushed(q, '🆘 SOS') || ']', pg_temp.pushed(q, '🆘 SOS') = '(none)');

  -- E3: w2 (on no team) on shift: manager who leads another team is not told
  select coalesce(max(id), 0) into q from net.http_request_queue;
  insert into public.sos_events (user_id, latitude, longitude, created_at) values (w2, 3, 3, t - interval '25 minutes') returning id into e3;
  got := pg_temp.pushed(q, '🆘 SOS');
  msg := msg || pg_temp.ok('SOS from a worker on no team reaches only owner and admin [' || got || ']', got = 'A Owner,B Admin');

  -- a manager's own SOS has no organization path
  select coalesce(max(id), 0) into q from net.http_request_queue;
  insert into public.sos_events (user_id, latitude, longitude, created_at) values (m1, 4, 4, t - interval '40 minutes');
  msg := msg || pg_temp.ok('a manager''s SOS does not alert the organization', pg_temp.pushed(q, '🆘 SOS') = '(none)');

  -- who can SEE each event through RLS
  perform pg_temp.sw(ad); select count(*) into n from public.sos_events where user_id = w1;
  msg := msg || pg_temp.ok('admin sees only w1''s on-shift SOS, not the off-shift one', n = 1);
  perform pg_temp.sw(o); select count(*) into n from public.sos_events where user_id in (w1, w2);
  msg := msg || pg_temp.ok('owner sees both workers'' on-shift SOS (2)', n = 2);
  perform pg_temp.sw(m1); select count(*) into n from public.sos_events where user_id in (w1, w2);
  msg := msg || pg_temp.ok('lead manager sees w1''s SOS but not w2''s (1)', n = 1);
  perform pg_temp.sw(m2); select count(*) into n from public.sos_events where user_id in (w1, w2);
  msg := msg || pg_temp.ok('manager of another team sees neither (0)', n = 0);
  perform pg_temp.sw(w2); select count(*) into n from public.sos_events where user_id = w1;
  msg := msg || pg_temp.ok('another worker cannot see w1''s SOS (0)', n = 0);
  perform pg_temp.sw(x); select count(*) into n from public.sos_events;
  msg := msg || pg_temp.ok('outsider sees no SOS (0)', n = 0);
  perform pg_temp.sw(w1); select count(*) into n from public.sos_events where user_id = w1;
  msg := msg || pg_temp.ok('the worker still sees their own SOS (2)', n = 2);

  -- acknowledge
  perform pg_temp.sw(m1); perform public.acknowledge_sos(e1);
  msg := msg || pg_temp.ok('lead manager can acknowledge their worker''s SOS', true);
  perform pg_temp.sw(m2);
  begin perform public.acknowledge_sos(e1); msg := msg || 'FAIL other-team manager acknowledged' || E'\n';
  exception when others then msg := msg || 'PASS other-team manager cannot acknowledge' || E'\n'; end;
  perform pg_temp.sw(x);
  begin perform public.acknowledge_sos(e1); msg := msg || 'FAIL outsider acknowledged' || E'\n';
  exception when others then msg := msg || 'PASS outsider cannot acknowledge' || E'\n'; end;
  perform pg_temp.sw(ad); select count(*) into n from public.sos_acknowledgements where sos_event_id = e1;
  msg := msg || pg_temp.ok('admin can read who acknowledged', n = 1);
  perform pg_temp.sw(m2); select count(*) into n from public.sos_acknowledgements where sos_event_id = e1;
  msg := msg || pg_temp.ok('other-team manager cannot read acknowledgements', n = 0);

  -- resolve
  perform pg_temp.sw(m1);
  update public.sos_events set resolved_at = now() where id = e3;
  get diagnostics n = row_count;
  msg := msg || pg_temp.ok('lead manager cannot resolve a SOS they cannot see', n = 0);
  perform pg_temp.sw(ad);
  update public.sos_events set resolved_at = now() where id = e3;
  get diagnostics n = row_count;
  msg := msg || pg_temp.ok('admin can resolve it', n = 1);

  -- escalation reaches the organization too
  perform pg_temp.su();
  insert into public.sos_events (user_id, latitude, longitude, created_at) values (w1, 5, 5, t - interval '15 minutes') returning id into e4;
  select coalesce(max(id), 0) into q from net.http_request_queue;
  select public.escalate_unacknowledged_sos() into n;
  got := pg_temp.pushed(q, '🆘 Still no one');
  msg := msg || pg_temp.ok('escalation re-alerts owner, admin and lead manager [' || got || ']', got = 'A Owner,B Admin,C Lead');

  -- a manager who is also in the worker's family circle is not alerted twice
  perform pg_temp.sw(cm);
  select c.circle_id, c.invite_code into circ, ccode from public.create_circle('Family') c;
  perform pg_temp.sw(w1); perform public.redeem_invite_code(ccode);
  perform pg_temp.sw(m1); perform public.redeem_invite_code(ccode);
  perform pg_temp.su();
  select coalesce(max(id), 0) into q from net.http_request_queue;
  insert into public.sos_events (user_id, latitude, longitude, created_at) values (w1, 6, 6, t - interval '12 minutes') returning id into e5;
  got := pg_temp.pushed(q, '🆘 SOS');
  msg := msg || pg_temp.ok('circle-mate manager is left to the circle alert, not doubled [' || got || ']', got = 'A Owner,B Admin');
  perform pg_temp.sw(cm); select count(*) into n from public.sos_events where user_id = w1;
  msg := msg || pg_temp.ok('family circle-mate still sees w1''s SOS through the circle (unchanged)', n >= 1);

  -- clocking out later does not hide an SOS that was sent on shift
  perform pg_temp.su();
  update public.shifts set clocked_out_at = t - interval '10 minutes' where user_id = w2;
  perform pg_temp.sw(ad); select count(*) into n from public.sos_events where id = e3;
  msg := msg || pg_temp.ok('an SOS sent on shift stays visible after the worker clocks out', n = 1);

  perform pg_temp.su();
  raise exception E'RESULT\n%', msg;
end $$;
