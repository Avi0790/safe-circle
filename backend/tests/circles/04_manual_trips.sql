-- Bus, train and flight trips (migration ...000060): manual trips that expire by
-- their ETA rather than by phone silence. Self-rolling-back: run with
-- `supabase db query --linked -f tests/circles/04_manual_trips.sql`; the
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
-- "<recipient names> :: <body>" for the push(es) whose title starts with prefix.
create function pg_temp.pushed(since bigint, prefix text) returns text language sql as $$
  select coalesce(string_agg(
           (select string_agg(p.full_name, ',' order by p.full_name)
              from jsonb_array_elements_text(j.body -> 'recipient_ids') r
              join public.profiles p on p.id = r::uuid) || ' :: ' || coalesce(j.body ->> 'body', '?'), ' | '), '(none)')
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
  circ uuid; code text; r uuid; t1 uuid; t2 uuid; t3 uuid; t4 uuid; q bigint; n int; m text; txt text; st text;
  msg text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (a,'a@test.invalid','{"full_name":"A Traveller"}'), (b,'b@test.invalid','{"full_name":"B Mate"}'),
    (c,'c@test.invalid','{"full_name":"C Hidden"}');
  perform pg_temp.sw(a);
  select x.circle_id, x.invite_code into circ, code from public.create_circle('Family') x;
  foreach r in array array[b, c] loop
    perform pg_temp.sw(r); perform public.redeem_invite_code(code);
  end loop;
  perform pg_temp.sw(a);
  perform public.hide_from(c);

  -- ===== the three kinds, their pushes, and who hears about them =====
  perform pg_temp.su();
  select coalesce(max(id), 0) into q from net.http_request_queue;
  perform pg_temp.sw(a);
  t1 := public.start_shared_trip(circ, 'Campus', now() + interval '25 minutes', 'bus');
  perform pg_temp.su();
  txt := pg_temp.pushed(q, '🚌');
  msg := msg || pg_temp.ok('bus: push reaches only the circle-mate [' || txt || ']', txt = 'B Mate :: Heading to Campus, arriving in about 25 min.');

  select coalesce(max(id), 0) into q from net.http_request_queue;
  perform pg_temp.sw(a);
  t2 := public.start_shared_trip(circ, 'Chicago', now() + interval '105 minutes', 'train');
  perform pg_temp.su();
  txt := pg_temp.pushed(q, '🚆');
  msg := msg || pg_temp.ok('train: long trips read in hours, not 105 min [' || txt || ']', txt = 'B Mate :: Heading to Chicago, arriving in about 1 h 45 min.');

  select coalesce(max(id), 0) into q from net.http_request_queue;
  perform pg_temp.sw(a);
  t3 := public.start_shared_trip(circ, 'Denver', now() + interval '4 hours 5 minutes', 'flight');
  perform pg_temp.su();
  txt := pg_temp.pushed(q, '✈️');
  msg := msg || pg_temp.ok('flight: says flying and landing [' || txt || ']', txt = 'B Mate :: Flying to Denver, landing in about 4 h 5 min.');
  select count(*) into n from public.shared_trips where id in (t1, t2) and status = 'ended';
  msg := msg || pg_temp.ok('each new trip ends the one before (one active)', n = 2);
  perform pg_temp.sw(b); select mode into m from public.shared_trips where id = t3;
  msg := msg || pg_temp.ok('a circle-mate sees the flight, as a flight', m = 'flight');
  perform pg_temp.sw(c); select count(*) into n from public.shared_trips where id = t3;
  msg := msg || pg_temp.ok('someone hidden from does not', n = 0);
  perform pg_temp.su();
  msg := msg || pg_temp.ok('exact-hour durations read cleanly', public.trip_duration_text(120) = '2 h' and public.trip_duration_text(89) = '89 min' and public.trip_duration_text(90) = '1 h 30 min');

  -- ===== how far ahead =====
  perform pg_temp.sw(a);
  begin perform public.start_shared_trip(circ, 'X', now() + interval '30 hours', 'bus'); msg := msg || pg_temp.ok('a 30-hour bus is refused', false);
  exception when others then msg := msg || pg_temp.ok('a 30-hour bus is refused', sqlerrm like '%24 hours%'); end;
  t4 := public.start_shared_trip(circ, 'Sydney', now() + interval '30 hours', 'flight');
  msg := msg || pg_temp.ok('a 30-hour journey by air is allowed', t4 is not null);
  begin perform public.start_shared_trip(circ, 'X', now() + interval '49 hours', 'flight'); msg := msg || pg_temp.ok('beyond 48 hours is refused even for a flight', false);
  exception when others then msg := msg || pg_temp.ok('beyond 48 hours is refused even for a flight', sqlerrm like '%48 hours%'); end;
  begin perform public.start_shared_trip(circ, 'X', now() + interval '1 hour', 'taxi'); msg := msg || pg_temp.ok('an unknown mode is refused', false);
  exception when others then msg := msg || pg_temp.ok('an unknown mode is refused', sqlerrm like 'Choose driving, walking, bus, train or flight%'); end;

  -- ===== running late =====
  perform pg_temp.su();
  update public.shared_trips set updated_at = now() - interval '1 minute' where id = t4;
  perform pg_temp.sw(a);
  perform public.update_shared_trip(t4, now() + interval '40 hours');
  perform pg_temp.su();
  select eta > now() + interval '39 hours' into st from public.shared_trips where id = t4;
  msg := msg || pg_temp.ok('a flight''s arrival time can be pushed back a few hours', st::boolean);
  update public.shared_trips set updated_at = now() - interval '1 minute' where id = t4;
  perform pg_temp.sw(a);
  begin perform public.update_shared_trip(t4, now() + interval '60 hours'); msg := msg || pg_temp.ok('...but not past 48 hours', false);
  exception when others then msg := msg || pg_temp.ok('...but not past 48 hours', true); end;
  -- a bus keeps the 24 hour limit when updated
  t1 := public.start_shared_trip(circ, 'Campus', now() + interval '20 minutes', 'bus');
  perform pg_temp.su();
  update public.shared_trips set updated_at = now() - interval '1 minute' where id = t1;
  perform pg_temp.sw(a);
  begin perform public.update_shared_trip(t1, now() + interval '30 hours'); msg := msg || pg_temp.ok('a bus cannot be pushed back past 24 hours', false);
  exception when others then msg := msg || pg_temp.ok('a bus cannot be pushed back past 24 hours', true); end;

  -- ===== expiry: manual trips go by ETA + grace, drives by silence =====
  perform pg_temp.su();
  -- a bus silent for 3 hours whose ETA is still ahead stays up (no heartbeat is expected)
  update public.shared_trips set updated_at = now() - interval '3 hours', eta = now() + interval '10 minutes' where id = t1;
  perform public.expire_stale_trips();
  select status into st from public.shared_trips where id = t1;
  msg := msg || pg_temp.ok('a bus nobody has heard from for hours is still up before its ETA', st = 'active');
  update public.shared_trips set eta = now() - interval '20 minutes' where id = t1;
  perform public.expire_stale_trips();
  select status into st from public.shared_trips where id = t1;
  msg := msg || pg_temp.ok('...and 20 minutes late is still within the 30-minute grace', st = 'active');
  update public.shared_trips set eta = now() - interval '31 minutes' where id = t1;
  perform public.expire_stale_trips();
  select status into st from public.shared_trips where id = t1;
  msg := msg || pg_temp.ok('...but 31 minutes late it fades out', st = 'stale');

  update public.shared_trips set status = 'active', ended_at = null, mode = 'train', eta = now() - interval '40 minutes' where id = t1;
  perform public.expire_stale_trips();
  select status into st from public.shared_trips where id = t1;
  msg := msg || pg_temp.ok('a train gets 45 minutes of grace', st = 'active');
  update public.shared_trips set eta = now() - interval '46 minutes' where id = t1;
  perform public.expire_stale_trips();
  select status into st from public.shared_trips where id = t1;
  msg := msg || pg_temp.ok('...and no more', st = 'stale');

  update public.shared_trips set status = 'active', ended_at = null, mode = 'flight', eta = now() - interval '110 minutes' where id = t1;
  perform public.expire_stale_trips();
  select status into st from public.shared_trips where id = t1;
  msg := msg || pg_temp.ok('a flight gets 2 hours of grace', st = 'active');
  update public.shared_trips set eta = now() - interval '121 minutes' where id = t1;
  perform public.expire_stale_trips();
  select status into st from public.shared_trips where id = t1;
  msg := msg || pg_temp.ok('...and no more', st = 'stale');

  -- a drive that has gone quiet still goes stale after 10 minutes
  update public.shared_trips set status = 'active', ended_at = null, mode = 'drive', eta = now() + interval '30 minutes',
    updated_at = now() - interval '11 minutes' where id = t1;
  perform public.expire_stale_trips();
  select status into st from public.shared_trips where id = t1;
  msg := msg || pg_temp.ok('a drive that went quiet still goes stale after 10 minutes', st = 'stale');
  update public.shared_trips set status = 'active', ended_at = null, mode = 'walk', updated_at = now() - interval '5 minutes' where id = t1;
  perform public.expire_stale_trips();
  select status into st from public.shared_trips where id = t1;
  msg := msg || pg_temp.ok('...and a walk that is only 5 minutes quiet stays up', st = 'active');

  -- ===== arriving, and the function surface =====
  perform pg_temp.su();
  select coalesce(max(id), 0) into q from net.http_request_queue;
  perform pg_temp.sw(a);
  t4 := public.start_shared_trip(circ, 'Sydney', now() + interval '3 hours', 'flight');   -- the bus above ended the first flight
  perform pg_temp.su();
  select coalesce(max(id), 0) into q from net.http_request_queue;
  perform pg_temp.sw(a);
  perform public.end_shared_trip(t4, true);
  perform pg_temp.su();
  txt := pg_temp.pushed(q, '✅');
  msg := msg || pg_temp.ok('landing tells the circle-mate [' || txt || ']', txt = 'B Mate :: They got to Sydney.');
  select count(*) into n from pg_proc where proname in ('start_shared_trip', 'update_shared_trip') and pronamespace = 'public'::regnamespace;
  msg := msg || pg_temp.ok('no duplicate overloads of the trip functions', n = 2);
  msg := msg || pg_temp.ok('the helpers are not callable from the API',
    not has_function_privilege('authenticated', 'public.manual_trip_grace(text)', 'execute')
    and not has_function_privilege('anon', 'public.trip_duration_text(int)', 'execute')
    and not has_function_privilege('authenticated', 'public.trip_duration_text(int)', 'execute'));
  msg := msg || pg_temp.ok('the cleanup job is still not callable',
    not has_function_privilege('authenticated', 'public.expire_stale_trips()', 'execute'));
  msg := msg || pg_temp.ok('signed-in users can still start and update trips',
    has_function_privilege('authenticated', 'public.start_shared_trip(uuid,text,timestamptz,text)', 'execute')
    and has_function_privilege('authenticated', 'public.update_shared_trip(uuid,timestamptz)', 'execute'));

  perform pg_temp.su();
  raise exception E'RESULT\n%', msg;
end $$;
