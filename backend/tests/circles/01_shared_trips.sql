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
  a uuid := '00000000-0000-0000-0000-0000000000a1';
  b uuid := '00000000-0000-0000-0000-0000000000b1';
  c uuid := '00000000-0000-0000-0000-0000000000c1';
  d uuid := '00000000-0000-0000-0000-0000000000d1';
  circ uuid; circ2 uuid; code text; r uuid; t1 uuid; t2 uuid; t3 uuid; q bigint; n int; n2 int;
  txt text; eta1 timestamptz; eta2 timestamptz; exp jsonb; msg text := '';
  trip_eta timestamptz := now() + interval '20 minutes';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (a,'a@test.invalid','{"full_name":"A Driver"}'), (b,'b@test.invalid','{"full_name":"B Mate"}'),
    (c,'c@test.invalid','{"full_name":"C Hidden"}'), (d,'d@test.invalid','{"full_name":"D Outsider"}');

  perform pg_temp.sw(a);
  select x.circle_id, x.invite_code into circ, code from public.create_circle('Family') x;
  foreach r in array array[b, c] loop
    perform pg_temp.sw(r); perform public.redeem_invite_code(code);
  end loop;
  perform pg_temp.sw(d);
  select x.circle_id into circ2 from public.create_circle('Other') x;
  perform pg_temp.sw(a);
  perform public.hide_from(c);            -- A hides from C (Ghost mode)

  -- ===== start =====
  perform pg_temp.su();
  select coalesce(max(id), 0) into q from net.http_request_queue;
  perform pg_temp.sw(a);
  t1 := public.start_shared_trip(circ, '  Walmart Supercenter  ', trip_eta);
  msg := msg || pg_temp.ok('a trip can be started', t1 is not null);
  select count(*) into n from public.shared_trips where id = t1;
  msg := msg || pg_temp.ok('the driver sees their own trip', n = 1);
  perform pg_temp.sw(b); select count(*) into n from public.shared_trips where id = t1;
  msg := msg || pg_temp.ok('a circle-mate sees it', n = 1);
  perform pg_temp.sw(c); select count(*) into n from public.shared_trips where id = t1;
  msg := msg || pg_temp.ok('someone the driver hid from (Ghost mode) does not', n = 0);
  perform pg_temp.sw(d); select count(*) into n from public.shared_trips where id = t1;
  msg := msg || pg_temp.ok('an outsider does not', n = 0);
  perform pg_temp.su();
  txt := pg_temp.pushed(q, '🚗');
  msg := msg || pg_temp.ok('only the circle-mate is pushed, not the hidden one [' || txt || ']', txt = 'B Mate');
  select destination into txt from public.shared_trips where id = t1;
  msg := msg || pg_temp.ok('the destination name is trimmed', txt = 'Walmart Supercenter');

  -- ===== one active trip at a time =====
  perform pg_temp.sw(a);
  t2 := public.start_shared_trip(circ, 'Campus', trip_eta);
  perform pg_temp.su();
  select count(*) into n from public.shared_trips where user_id = a and status = 'active';
  select status into txt from public.shared_trips where id = t1;
  msg := msg || pg_temp.ok('starting another trip ends the first (one active)', n = 1 and txt = 'ended');

  -- ===== updating the ETA =====
  perform pg_temp.sw(a);
  perform public.update_shared_trip(t2, now() + interval '30 minutes');
  perform pg_temp.su();
  select eta into eta1 from public.shared_trips where id = t2;
  msg := msg || pg_temp.ok('an update within 15 seconds of the last is ignored', eta1 < now() + interval '25 minutes');
  update public.shared_trips set updated_at = now() - interval '1 minute' where id = t2;
  perform pg_temp.sw(a);
  perform public.update_shared_trip(t2, now() + interval '30 minutes');
  perform pg_temp.su();
  select eta into eta2 from public.shared_trips where id = t2;
  msg := msg || pg_temp.ok('a later update changes the ETA', eta2 > now() + interval '29 minutes');

  -- ===== nobody else can change it =====
  perform pg_temp.sw(b);
  perform public.update_shared_trip(t2, now() + interval '5 hours');
  perform public.end_shared_trip(t2, true);
  perform pg_temp.su();
  select status, eta into txt, eta1 from public.shared_trips where id = t2;
  msg := msg || pg_temp.ok('a circle-mate cannot update or end someone else''s trip', txt = 'active' and eta1 < now() + interval '2 hours');
  perform pg_temp.sw(b);
  begin insert into public.shared_trips (user_id, circle_id, destination, eta) values (b, circ, 'x', trip_eta);
    msg := msg || 'FAIL direct insert into shared_trips' || E'\n';
  exception when others then msg := msg || 'PASS cannot insert trips directly' || E'\n'; end;
  perform pg_temp.sw(a);
  update public.shared_trips set destination = 'tampered' where id = t2;
  get diagnostics n = row_count;
  msg := msg || pg_temp.ok('the driver cannot edit a trip directly either', n = 0);

  -- ===== arriving =====
  perform pg_temp.su();
  select coalesce(max(id), 0) into q from net.http_request_queue;
  perform pg_temp.sw(a);
  perform public.end_shared_trip(t2, true);
  perform public.end_shared_trip(t2, true);
  perform pg_temp.su();
  select status into txt from public.shared_trips where id = t2;
  msg := msg || pg_temp.ok('arriving marks the trip arrived', txt = 'arrived');
  txt := pg_temp.pushed(q, '✅');
  msg := msg || pg_temp.ok('...and tells only the circle-mate, once [' || txt || ']', txt = 'B Mate');

  -- stopping a trip is silent
  perform pg_temp.sw(a);
  t3 := public.start_shared_trip(circ, 'Home', trip_eta);
  perform pg_temp.su();
  select coalesce(max(id), 0) into q from net.http_request_queue;
  perform pg_temp.sw(a);
  perform public.end_shared_trip(t3, false);
  perform pg_temp.su();
  select status into txt from public.shared_trips where id = t3;
  msg := msg || pg_temp.ok('stopping a trip ends it without telling anyone', txt = 'ended' and pg_temp.pushed(q, '✅') = '(none)');

  -- ===== validation =====
  perform pg_temp.sw(a);
  begin perform public.start_shared_trip(circ, '   ', trip_eta); msg := msg || 'FAIL empty destination accepted' || E'\n';
  exception when others then msg := msg || 'PASS empty destination refused' || E'\n'; end;
  begin perform public.start_shared_trip(circ, repeat('x', 81), eta); msg := msg || 'FAIL 81 char destination accepted' || E'\n';
  exception when others then msg := msg || 'PASS over-long destination refused' || E'\n'; end;
  begin perform public.start_shared_trip(circ, 'Past', now() - interval '1 hour'); msg := msg || 'FAIL past ETA accepted' || E'\n';
  exception when others then msg := msg || 'PASS an ETA in the past is refused' || E'\n'; end;
  begin perform public.start_shared_trip(circ, 'Far', now() + interval '25 hours'); msg := msg || 'FAIL ETA beyond 24h accepted' || E'\n';
  exception when others then msg := msg || 'PASS an ETA beyond 24 hours is refused' || E'\n'; end;
  begin perform public.start_shared_trip(circ2, 'Elsewhere', trip_eta); msg := msg || 'FAIL shared into a circle they are not in' || E'\n';
  exception when others then msg := msg || 'PASS cannot share into a circle you are not in' || E'\n'; end;

  -- ===== sharing window ended: no visibility, no push =====
  perform pg_temp.sw(a);
  t1 := public.start_shared_trip(circ, 'Mall', trip_eta);
  perform pg_temp.su();
  update public.profiles set share_until = now() - interval '1 minute' where id = a;
  perform pg_temp.sw(b); select count(*) into n from public.shared_trips where id = t1;
  msg := msg || pg_temp.ok('once the driver''s sharing window ends, circle-mates cannot see the trip', n = 0);
  perform pg_temp.su();
  select coalesce(max(id), 0) into q from net.http_request_queue;
  perform pg_temp.sw(a);
  perform public.start_shared_trip(circ, 'Gym', trip_eta);
  perform pg_temp.su();
  msg := msg || pg_temp.ok('...and starting one while not sharing pushes nobody', pg_temp.pushed(q, '🚗') = '(none)');
  update public.profiles set share_until = null where id = a;

  -- ===== expiry =====
  update public.shared_trips set updated_at = now() - interval '11 minutes' where status = 'active';
  insert into public.shared_trips (user_id, circle_id, destination, eta, status, started_at, ended_at)
    values (b, circ, 'Old', now(), 'arrived', now() - interval '4 days', now() - interval '3 days');
  select public.expire_stale_trips() into n;
  select count(*) into n2 from public.shared_trips where destination = 'Old';
  select count(*) into n from public.shared_trips where status = 'stale';
  msg := msg || pg_temp.ok('a trip nobody has heard from in 10 minutes goes stale', n >= 1);
  msg := msg || pg_temp.ok('finished trips older than 2 days are deleted', n2 = 0);

  -- ===== internal helpers are not callable =====
  perform pg_temp.sw(b);
  begin perform public.trip_recipients(circ, a); msg := msg || 'FAIL recipient list callable' || E'\n';
  exception when others then msg := msg || 'PASS the recipient helper is not callable' || E'\n'; end;
  begin perform public.expire_stale_trips(); msg := msg || 'FAIL cleanup job callable' || E'\n';
  exception when others then msg := msg || 'PASS the cleanup job is not callable' || E'\n'; end;

  -- ===== export =====
  perform pg_temp.sw(a);
  exp := public.export_my_data();
  msg := msg || pg_temp.ok('export includes the trips you shared (destination only, no coordinates)',
    jsonb_array_length(exp -> 'shared_trips') >= 1
    and (exp -> 'shared_trips' -> 0) ? 'destination'
    and not (exp -> 'shared_trips' -> 0) ? 'latitude');
  perform pg_temp.sw(b);
  exp := public.export_my_data();
  msg := msg || pg_temp.ok('...and never someone else''s (B shared none, and sees none of A''s)', jsonb_array_length(exp -> 'shared_trips') = 0);

  perform pg_temp.su();
  raise exception E'RESULT\n%', msg;
end $$;
