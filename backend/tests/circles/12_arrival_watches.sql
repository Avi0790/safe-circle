-- "Notify me when they arrive" (migration ...000081). Rolls itself back;
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
-- arrival-alert pushes only (a place's own "arrived" alert to the circle
-- goes through the same queue)
create function pg_temp.pushes() returns bigint language sql as $$
  select count(*) from net.http_request_queue where convert_from(body, 'UTF8') like '%arrival_watch%'
$$;
create function pg_temp.err(sql text) returns text language plpgsql as $$
begin execute sql; return null; exception when others then return sqlerrm; end $$;

do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000a1';  -- the watcher
  b uuid := '00000000-0000-0000-0000-0000000000b1';  -- the one being watched
  x uuid := '00000000-0000-0000-0000-0000000000c1';  -- an outsider
  c uuid; code text; home uuid; w1 uuid; w2 uuid; q bigint; txt text; ex jsonb;
  msg text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (a, 'a@test.invalid', '{"full_name":"Ann"}'), (b, 'b@test.invalid', '{"full_name":"Ben"}'),
    (x, 'x@test.invalid', '{"full_name":"Out"}');
  perform pg_temp.sw(a);
  select r.circle_id, r.invite_code into c, code from public.create_circle('Fam') r;
  insert into public.places (circle_id, name, latitude, longitude, radius_meters) values (c, 'Home', 35.84, -90.70, 150) returning id into home;
  perform pg_temp.sw(b); perform public.redeem_invite_code(code);
  insert into public.locations (latitude, longitude, recorded_at) values (35.80, -90.70, now() - interval '5 minutes');

  -- ===== setting one =====
  perform pg_temp.sw(x);
  txt := pg_temp.err(format('select public.create_arrival_watch(%L, %L, %L)', b, 'arrive', home));
  msg := msg || pg_temp.ok('an outsider can''t watch Ben', txt like 'You can only be notified%');
  perform pg_temp.sw(a);
  w1 := public.create_arrival_watch(b, 'arrive', home);
  msg := msg || pg_temp.ok('Ann asks to be told when Ben gets Home', w1 is not null);
  txt := pg_temp.err(format('select public.create_arrival_watch(%L, %L, null, 35.84, -90.70, %L)', b, 'leave', 'Home'));
  msg := msg || pg_temp.ok('"when he leaves" only where he is now', txt = 'They''re not there now.');
  w2 := public.create_arrival_watch(b, 'leave', null, 35.80, -90.70, '  2508 E Johnson Ave  ');
  msg := msg || pg_temp.ok('and "when he leaves 2508 E Johnson Ave"', (select label from public.arrival_watches where id = w2) = '2508 E Johnson Ave');
  perform pg_temp.sw(b);
  msg := msg || pg_temp.ok('Ben can''t read Ann''s alerts', (select count(*) from public.arrival_watches) = 0);

  -- ===== firing ===== (now() is fixed in a transaction, so each position gets its own time)
  perform pg_temp.su();
  q := pg_temp.pushes();
  perform pg_temp.sw(b);
  insert into public.locations (latitude, longitude, recorded_at) values (35.8003, -90.7002, now() + interval '1 minute');   -- still there
  perform pg_temp.su();
  msg := msg || pg_temp.ok('moving a few metres fires nothing', pg_temp.pushes() = q);
  perform pg_temp.sw(b);
  insert into public.locations (latitude, longitude, recorded_at) values (35.82, -90.70, now() + interval '2 minutes');       -- on the way
  perform pg_temp.su();
  msg := msg || pg_temp.ok('leaving fires "left", once', pg_temp.pushes() = q + 1
    and (select fired_at from public.arrival_watches where id = w2) is not null
    and (select fired_at from public.arrival_watches where id = w1) is null);
  perform pg_temp.sw(b);
  insert into public.locations (latitude, longitude, recorded_at) values (35.8402, -90.7001, now() + interval '3 minutes');    -- home
  insert into public.locations (latitude, longitude, recorded_at) values (35.8401, -90.7, now() + interval '4 minutes');       -- still home
  perform pg_temp.su();
  msg := msg || pg_temp.ok('arriving home fires "arrived", once', pg_temp.pushes() = q + 2);

  -- ===== ghost mode silences it =====
  perform pg_temp.sw(a);
  w1 := public.create_arrival_watch(b, 'leave', home);
  perform pg_temp.sw(b);
  perform public.hide_from(a);
  perform pg_temp.su(); q := pg_temp.pushes();
  perform pg_temp.sw(b);
  insert into public.locations (latitude, longitude, recorded_at) values (35.90, -90.70, now() + interval '5 minutes');
  perform pg_temp.su();
  msg := msg || pg_temp.ok('after Ben hides from Ann, she isn''t told', pg_temp.pushes() = q);
  perform pg_temp.sw(a);
  txt := pg_temp.err(format('select public.create_arrival_watch(%L, %L, %L)', b, 'arrive', home));
  msg := msg || pg_temp.ok('nor can she set a new one', txt like 'You can only be notified%');

  ex := public.export_my_data();
  msg := msg || pg_temp.ok('Ann''s alerts are in "Download my data"', jsonb_array_length(ex -> 'arrival_alerts_you_set') = 3 and ex ? 'profile');

  raise exception E'RESULT\n%', msg;
end $$;
