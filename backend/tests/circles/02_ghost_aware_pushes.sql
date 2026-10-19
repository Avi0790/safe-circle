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
-- Names (sorted, comma-separated) of everyone sent a push whose title starts
-- with `prefix`, across all requests queued after `since`; '(none)' if no push.
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
-- Was the SOS push (which goes to the whole circle) queued for this SOS event?
create function pg_temp.sos_queued(since bigint, sos bigint) returns boolean language sql as $$
  select exists (
    select 1 from (
      select (case when pg_typeof(q.body)::text = 'bytea' then convert_from(q.body::bytea, 'utf8') else q.body::text end)::jsonb as body
      from net.http_request_queue q
      where q.id > since and q.url like '%send-sos-push%'
    ) j
    where (j.body -> 'record' ->> 'id')::bigint = sos
  )
$$;

do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000a1';
  b uuid := '00000000-0000-0000-0000-0000000000b1';
  c uuid := '00000000-0000-0000-0000-0000000000c1';
  d uuid := '00000000-0000-0000-0000-0000000000d1';
  circ uuid; circ2 uuid; code text; r uuid; place uuid; w1 uuid; w2 uuid; w3 uuid; tm1 uuid; tm2 uuid;
  q bigint; n int; sos1 bigint; sos2 bigint; txt text; msg text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (a,'a@test.invalid','{"full_name":"A Walker"}'), (b,'b@test.invalid','{"full_name":"B Mate"}'),
    (c,'c@test.invalid','{"full_name":"C Hidden"}'), (d,'d@test.invalid','{"full_name":"D Outsider"}');

  perform pg_temp.sw(a);
  select x.circle_id, x.invite_code into circ, code from public.create_circle('Family') x;
  foreach r in array array[b, c] loop
    perform pg_temp.sw(r); perform public.redeem_invite_code(code);
  end loop;
  perform pg_temp.sw(d);
  select x.circle_id into circ2 from public.create_circle('Other') x;

  perform pg_temp.su();
  insert into public.places (circle_id, name, latitude, longitude, radius_meters, created_by)
    values (circ, 'Dorm', 40.0, -100.0, 100, a) returning id into place;

  perform pg_temp.sw(a);
  perform public.hide_from(c);            -- A hides from C (Ghost mode)

  -- ===== Walk me home: start =====
  perform pg_temp.su();
  select coalesce(max(id), 0) into q from net.http_request_queue;
  perform pg_temp.sw(a);
  w1 := public.start_walk(place, 30);
  perform pg_temp.su();
  txt := pg_temp.pushed(q, '🚶');
  msg := msg || pg_temp.ok('walk start: only the circle-mate is pushed, not the hidden one [' || txt || ']', txt = 'B Mate');

  -- ===== Walk me home: "I''m safe" =====
  select coalesce(max(id), 0) into q from net.http_request_queue;
  perform pg_temp.sw(a);
  perform public.end_walk(w1);
  perform pg_temp.su();
  txt := pg_temp.pushed(q, '✅');
  msg := msg || pg_temp.ok('walk end: only the circle-mate is pushed [' || txt || ']', txt = 'B Mate');

  -- ===== Walk me home: arrival =====
  perform pg_temp.sw(a);
  w2 := public.start_walk(place, 30);
  perform pg_temp.su();
  select coalesce(max(id), 0) into q from net.http_request_queue;
  insert into public.locations (user_id, latitude, longitude) values (a, 40.0, -100.0);
  select status into txt from public.walks where id = w2;
  msg := msg || pg_temp.ok('walk arrival closes the walk', txt = 'arrived');
  msg := msg || pg_temp.ok('walk arrival: only the circle-mate is pushed [' || pg_temp.pushed(q, '✅') || ']', pg_temp.pushed(q, '✅') = 'B Mate');

  -- ===== Overdue walk: the automatic SOS still reaches the hidden person =====
  perform pg_temp.sw(a);
  w3 := public.start_walk(place, 30);
  perform pg_temp.su();
  update public.walks set expected_by = now() - interval '1 minute' where id = w3;
  select coalesce(max(id), 0) into q from net.http_request_queue;
  select public.expire_walks() into n;
  select sos_event_id into sos1 from public.walks where id = w3;
  msg := msg || pg_temp.ok('an overdue walk becomes overdue and raises an SOS', n = 1 and sos1 is not null);
  msg := msg || pg_temp.ok('...whose push (to the whole circle) is queued', pg_temp.sos_queued(q, sos1));
  msg := msg || pg_temp.ok('...and the SOS recipient list includes the hidden person',
    c = any (public.circle_recipients_all(a)) and b = any (public.circle_recipients_all(a)));
  perform pg_temp.sw(c); select count(*) into n from public.sos_events where id = sos1;
  msg := msg || pg_temp.ok('the person hidden from can see that SOS', n = 1);
  perform pg_temp.sw(b); select count(*) into n from public.sos_events where id = sos1;
  msg := msg || pg_temp.ok('the circle-mate can see that SOS', n = 1);

  -- ...and the all-clear goes to the same people who got the SOS
  perform pg_temp.su();
  select coalesce(max(id), 0) into q from net.http_request_queue;
  perform pg_temp.sw(a);
  perform public.end_walk(w3);
  perform pg_temp.su();
  txt := pg_temp.pushed(q, '✅');
  msg := msg || pg_temp.ok('ending an overdue walk tells everyone who got the SOS, hidden person included [' || txt || ']', txt = 'B Mate,C Hidden');
  select count(*) into n from public.sos_events where id = sos1 and resolved_at is not null;
  msg := msg || pg_temp.ok('...and resolves the SOS', n = 1);

  -- ===== Check on me: start / check in =====
  select coalesce(max(id), 0) into q from net.http_request_queue;
  perform pg_temp.sw(a);
  tm1 := public.start_safety_timer(circ, 'Library', 30);
  perform pg_temp.su();
  txt := pg_temp.pushed(q, '⏱️');
  msg := msg || pg_temp.ok('check-on-me start: only the circle-mate is pushed [' || txt || ']', txt = 'B Mate');
  select coalesce(max(id), 0) into q from net.http_request_queue;
  perform pg_temp.sw(a);
  perform public.end_safety_timer(tm1);
  perform pg_temp.su();
  txt := pg_temp.pushed(q, '✅');
  msg := msg || pg_temp.ok('check-on-me check-in: only the circle-mate is pushed [' || txt || ']', txt = 'B Mate');

  -- ===== Overdue check on me: SOS still reaches the hidden person =====
  insert into public.locations (user_id, latitude, longitude) values (a, 10.0, 10.0);
  perform pg_temp.sw(a);
  tm2 := public.start_safety_timer(circ, 'Hike', 30);
  perform pg_temp.su();
  update public.safety_timers set expected_by = now() - interval '1 minute' where id = tm2;
  select coalesce(max(id), 0) into q from net.http_request_queue;
  select public.expire_safety_timers() into n;
  select sos_event_id into sos2 from public.safety_timers where id = tm2;
  msg := msg || pg_temp.ok('an overdue check-on-me raises an SOS', n = 1 and sos2 is not null);
  msg := msg || pg_temp.ok('...whose push (to the whole circle) is queued', pg_temp.sos_queued(q, sos2));
  perform pg_temp.sw(c); select count(*) into n from public.sos_events where id = sos2;
  msg := msg || pg_temp.ok('the person hidden from can see that SOS', n = 1);
  perform pg_temp.su();
  select coalesce(max(id), 0) into q from net.http_request_queue;
  perform pg_temp.sw(a);
  perform public.end_safety_timer(tm2);
  perform pg_temp.su();
  txt := pg_temp.pushed(q, '✅');
  msg := msg || pg_temp.ok('checking in after an overdue timer tells everyone who got the SOS [' || txt || ']', txt = 'B Mate,C Hidden');

  -- ===== Manual SOS is untouched =====
  select coalesce(max(id), 0) into q from net.http_request_queue;
  perform pg_temp.sw(a);
  insert into public.sos_events (user_id, latitude, longitude, message) values (a, 1, 1, 'help') returning id into sos1;
  perform pg_temp.su();
  msg := msg || pg_temp.ok('a manual SOS is still sent for the whole circle', pg_temp.sos_queued(q, sos1));

  -- ===== Meetup pins =====
  select coalesce(max(id), 0) into q from net.http_request_queue;
  perform pg_temp.sw(a);
  perform public.drop_pin(circ, '📍', 'Meet at the gate', 40.0, -100.0, 60);
  perform pg_temp.su();
  txt := pg_temp.pushed(q, '📍');
  msg := msg || pg_temp.ok('pin dropped: only the circle-mate is pushed [' || txt || ']', txt = 'B Mate');
  perform pg_temp.sw(c); select count(*) into n from public.map_pins where circle_id = circ;
  msg := msg || pg_temp.ok('...but the pin itself is still on the hidden person''s map', n = 1);

  -- ===== Sharing window ended: no routine pushes =====
  perform pg_temp.su();
  update public.profiles set share_until = now() - interval '1 minute' where id = a;
  select coalesce(max(id), 0) into q from net.http_request_queue;
  perform pg_temp.sw(a);
  perform public.drop_pin(circ, '📍', 'Second pin', 40.0, -100.0, 60);
  perform pg_temp.su();
  msg := msg || pg_temp.ok('while the sender is not sharing, nobody is pushed', pg_temp.pushed(q, '📍') = '(none)');
  update public.profiles set share_until = null where id = a;

  -- ===== Unhiding restores the push =====
  perform pg_temp.sw(a);
  perform public.unhide_from(c);
  perform pg_temp.su();
  select coalesce(max(id), 0) into q from net.http_request_queue;
  perform pg_temp.sw(a);
  perform public.drop_pin(circ, '📍', 'Third pin', 40.0, -100.0, 60);
  perform pg_temp.su();
  txt := pg_temp.pushed(q, '📍');
  msg := msg || pg_temp.ok('once unhidden, both circle-mates are pushed [' || txt || ']', txt = 'B Mate,C Hidden');

  -- ===== Internal helpers are not callable =====
  perform pg_temp.sw(b);
  begin perform public.routine_recipients(circ, a); msg := msg || 'FAIL routine_recipients callable' || E'\n';
  exception when others then msg := msg || 'PASS the recipient helper is not callable' || E'\n'; end;
  begin perform public.circle_recipients(circ, a); msg := msg || 'FAIL circle_recipients callable' || E'\n';
  exception when others then msg := msg || 'PASS circle_recipients is still not callable' || E'\n'; end;
  begin perform public.expire_walks(); msg := msg || 'FAIL expire_walks callable' || E'\n';
  exception when others then msg := msg || 'PASS expire_walks is still not callable' || E'\n'; end;
  begin perform public.expire_safety_timers(); msg := msg || 'FAIL expire_safety_timers callable' || E'\n';
  exception when others then msg := msg || 'PASS expire_safety_timers is still not callable' || E'\n'; end;
  -- ...while the user-facing functions still are
  perform pg_temp.sw(a);
  begin perform public.drop_pin(circ, '📍', 'Callable', 40.0, -100.0, 60); msg := msg || 'PASS drop_pin is still callable by a signed-in user' || E'\n';
  exception when others then msg := msg || 'FAIL drop_pin no longer callable: ' || sqlerrm || E'\n'; end;

  perform pg_temp.su();
  raise exception E'RESULT\n%', msg;
end $$;
