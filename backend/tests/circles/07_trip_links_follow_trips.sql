-- Trip links that follow a bus, train or flight trip (migration ...000063).
-- Self-rolling-back: run with
-- `supabase db query --linked -f tests/circles/07_trip_links_follow_trips.sql`; the
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
create function pg_temp.anon() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end $$;

do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000a1';
  b uuid := '00000000-0000-0000-0000-0000000000b1';
  circ uuid; code text; trip uuid; trip2 uuid; lid uuid; tok text; lid2 uuid; tok2 text; lid3 uuid; tok3 text;
  n int; r record; exp1 timestamptz; ok boolean;
  msg text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (a,'a@test.invalid','{"full_name":"Alex Traveller"}'), (b,'b@test.invalid','{"full_name":"B Mate"}');
  insert into public.locations (user_id, latitude, longitude, accuracy, battery_level, recorded_at)
    values (a, 35.84, -90.70, 10, 0.8, now());
  perform pg_temp.sw(a);
  select x.circle_id, x.invite_code into circ, code from public.create_circle('Family') x;
  perform pg_temp.sw(b); perform public.redeem_invite_code(code);

  -- ===== a link for a flight =====
  perform pg_temp.sw(a);
  trip := public.start_shared_trip(circ, 'Denver', now() + interval '30 hours', 'flight');
  select x.id, x.token into lid, tok from public.create_trip_share_link('ignored', now(), 'drive', trip) x;
  perform pg_temp.anon();
  select * into r from public.get_shared_location(tok);
  msg := msg || pg_temp.ok('the link describes the trip itself (not what the caller passed)',
    r.trip_destination = 'Denver' and r.trip_mode = 'flight' and r.trip_eta > now() + interval '29 hours');
  perform pg_temp.su();
  select expires_at into exp1 from public.share_links where id = lid;
  msg := msg || pg_temp.ok('a flight link can be over a day ahead and lasts 2 hours past landing',
    exp1 between now() + interval '31 hours 59 minutes' and now() + interval '32 hours 1 minute');

  -- ===== running late moves the link =====
  update public.shared_trips set updated_at = now() - interval '1 minute' where id = trip;
  perform pg_temp.sw(a);
  perform public.update_shared_trip(trip, now() + interval '33 hours');
  perform pg_temp.anon();
  select * into r from public.get_shared_location(tok);
  msg := msg || pg_temp.ok('a later ETA on the trip shows on the link', r.trip_eta > now() + interval '32 hours');
  perform pg_temp.su();
  select expires_at into exp1 from public.share_links where id = lid;
  msg := msg || pg_temp.ok('...and the link ends later with it', exp1 > now() + interval '34 hours');

  -- ===== landing =====
  perform pg_temp.sw(a);
  perform public.end_shared_trip(trip, true);
  perform pg_temp.anon();
  select * into r from public.get_shared_location(tok);
  msg := msg || pg_temp.ok('arriving on the trip tells whoever has the link, without a location',
    r.trip_status = 'arrived' and r.latitude is null and r.recorded_at is null);
  perform pg_temp.su();
  select expires_at into exp1 from public.share_links where id = lid;
  msg := msg || pg_temp.ok('...and the link ends 15 minutes later', exp1 <= now() + interval '15 minutes');

  -- ===== stopping, or a new trip, ends the link =====
  perform pg_temp.sw(a);
  trip := public.start_shared_trip(circ, 'Campus', now() + interval '25 minutes', 'bus');
  select x.id, x.token into lid2, tok2 from public.create_trip_share_link('', now(), 'drive', trip) x;
  perform pg_temp.su();
  select expires_at into exp1 from public.share_links where id = lid2;
  msg := msg || pg_temp.ok('a bus link lasts 30 minutes past its ETA', exp1 between now() + interval '54 minutes' and now() + interval '56 minutes');
  perform pg_temp.sw(a);
  perform public.end_shared_trip(trip, false);
  perform pg_temp.anon();
  select count(*) into n from public.get_shared_location(tok2);
  msg := msg || pg_temp.ok('stopping the trip ends its link at once', n = 0);

  perform pg_temp.sw(a);
  trip := public.start_shared_trip(circ, 'Chicago', now() + interval '2 hours', 'train');
  select x.id, x.token into lid3, tok3 from public.create_trip_share_link('', now(), 'drive', trip) x;
  trip2 := public.start_shared_trip(circ, 'Gym', now() + interval '20 minutes', 'bus');
  perform pg_temp.anon();
  select count(*) into n from public.get_shared_location(tok3);
  msg := msg || pg_temp.ok('starting another trip ends the old trip''s link', n = 0);

  -- ===== the trip expiring ends its link =====
  perform pg_temp.sw(a);
  select x.id, x.token into lid3, tok3 from public.create_trip_share_link('', now(), 'drive', trip2) x;
  perform pg_temp.su();
  update public.shared_trips set eta = now() - interval '31 minutes' where id = trip2;
  perform public.expire_stale_trips();
  perform pg_temp.anon();
  select count(*) into n from public.get_shared_location(tok3);
  msg := msg || pg_temp.ok('when the trip expires, its link ends too', n = 0);

  -- ===== only your own active trip =====
  perform pg_temp.sw(b);
  ok := false;
  begin perform public.create_trip_share_link('', now(), 'drive', trip2); exception when others then ok := sqlerrm like 'Trip not found%'; end;
  msg := msg || pg_temp.ok('nobody else can make a link for your trip', ok);
  perform pg_temp.sw(a);
  ok := false;
  begin perform public.create_trip_share_link('', now(), 'drive', trip2); exception when others then ok := sqlerrm like 'Trip not found%'; end;
  msg := msg || pg_temp.ok('...nor can you for a trip that has ended', ok);

  -- ===== links not tied to a trip, and limits =====
  select x.id, x.token into lid, tok from public.create_trip_share_link('Walmart', now() + interval '20 minutes', 'drive') x;
  perform pg_temp.su();
  select expires_at into exp1 from public.share_links where id = lid;
  msg := msg || pg_temp.ok('a link from Directions (no trip) still lasts 30 minutes past the ETA', exp1 between now() + interval '49 minutes' and now() + interval '51 minutes');
  perform pg_temp.sw(a);
  ok := false;
  begin perform public.create_trip_share_link('Far', now() + interval '30 hours', 'drive'); exception when others then ok := sqlerrm like '%24 hours%'; end;
  msg := msg || pg_temp.ok('a drive cannot be a day and a half away', ok);
  perform pg_temp.su();
  update public.share_links set trip_updated_at = now() - interval '1 minute' where id = lid;
  perform pg_temp.sw(a);
  perform public.update_trip_share_link(lid, now() + interval '40 minutes');
  perform pg_temp.su();
  select expires_at into exp1 from public.share_links where id = lid;
  msg := msg || pg_temp.ok('updating a Directions link still works', exp1 between now() + interval '69 minutes' and now() + interval '71 minutes');

  -- ===== surface =====
  select count(*) into n from pg_proc where proname = 'create_trip_share_link' and pronamespace = 'public'::regnamespace;
  msg := msg || pg_temp.ok('one create_trip_share_link (no leftover overload)', n = 1);
  msg := msg || pg_temp.ok('signed-in users can call it, anonymous ones cannot',
    has_function_privilege('authenticated', 'public.create_trip_share_link(text,timestamptz,text,uuid)', 'execute')
    and not has_function_privilege('anon', 'public.create_trip_share_link(text,timestamptz,text,uuid)', 'execute'));
  msg := msg || pg_temp.ok('the expiry helper is internal',
    not has_function_privilege('authenticated', 'public.trip_link_expiry(timestamptz,text)', 'execute'));

  raise exception E'RESULT\n%', msg;
end $$;
