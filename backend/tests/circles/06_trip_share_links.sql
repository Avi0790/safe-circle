-- Share ETA with anyone: trip links (migration ...000062). Self-rolling-back:
-- run with `supabase db query --linked -f tests/circles/06_trip_share_links.sql`; the
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
  lid uuid; tok text; lid2 uuid; tok2 uuid; plain text; n int; r record; exp1 timestamptz; exp2 timestamptz; ok boolean;
  msg text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (a,'a@test.invalid','{"full_name":"Alex Driver"}'), (b,'b@test.invalid','{"full_name":"B Other"}');
  insert into public.locations (user_id, latitude, longitude, accuracy, battery_level, recorded_at)
    values (a, 35.84, -90.70, 10, 0.8, now());

  -- ===== creating =====
  perform pg_temp.sw(a);
  select x.id, x.token into lid, tok from public.create_trip_share_link('  Walmart Supercenter ', now() + interval '20 minutes', 'drive') x;
  msg := msg || pg_temp.ok('a trip link comes back with an id and a one-time token', lid is not null and length(tok) = 48);
  perform pg_temp.su();
  select expires_at into exp1 from public.share_links where id = lid;
  msg := msg || pg_temp.ok('it lasts until 30 minutes after the ETA', exp1 between now() + interval '49 minutes' and now() + interval '51 minutes');
  select count(*) into n from public.share_links where token_hash = tok;
  msg := msg || pg_temp.ok('only a hash of the token is stored', n = 0);

  -- ===== what the person with the link sees =====
  perform pg_temp.anon();
  select * into r from public.get_shared_location(tok);
  msg := msg || pg_temp.ok('anyone with the link sees the first name, destination, ETA and position',
    r.first_name = 'Alex' and r.trip_destination = 'Walmart Supercenter' and r.trip_mode = 'drive'
    and r.trip_status = 'active' and r.latitude = 35.84 and r.trip_eta > now());
  select count(*) into n from public.get_shared_location('not-a-real-token');
  msg := msg || pg_temp.ok('a wrong token shows nothing', n = 0);
  ok := false;
  begin perform public.create_trip_share_link('X', now() + interval '10 minutes', 'drive'); exception when others then ok := true; end;
  msg := msg || pg_temp.ok('someone without an account cannot make links', ok);

  -- ===== keeping the ETA fresh =====
  perform pg_temp.sw(a);
  perform public.update_trip_share_link(lid, now() + interval '35 minutes');
  perform pg_temp.su();
  select trip_eta < now() + interval '25 minutes' into ok from public.share_links where id = lid;
  msg := msg || pg_temp.ok('an update within 15 seconds is ignored', ok);
  update public.share_links set trip_updated_at = now() - interval '1 minute' where id = lid;
  perform pg_temp.sw(a);
  perform public.update_trip_share_link(lid, now() + interval '35 minutes');
  perform pg_temp.su();
  select expires_at into exp2 from public.share_links where id = lid;
  msg := msg || pg_temp.ok('a later ETA moves the ETA and the link''s end with it',
    exp2 between now() + interval '64 minutes' and now() + interval '66 minutes');
  update public.share_links set trip_updated_at = now() - interval '1 minute' where id = lid;
  perform pg_temp.sw(b);
  perform public.update_trip_share_link(lid, now() + interval '5 hours');
  perform public.finish_trip_share_link(lid, false);
  perform pg_temp.su();
  select count(*) into n from public.share_links where id = lid and revoked_at is null and trip_eta < now() + interval '1 hour';
  msg := msg || pg_temp.ok('someone else cannot change or end your link', n = 1);
  perform pg_temp.sw(b);
  select count(*) into n from public.share_links where id = lid;
  msg := msg || pg_temp.ok('...or even see it', n = 0);
  perform pg_temp.sw(a);
  begin update public.share_links set expires_at = now() + interval '30 days' where id = lid; exception when others then null; end;
  perform pg_temp.su();
  select expires_at into exp1 from public.share_links where id = lid;
  msg := msg || pg_temp.ok('you cannot stretch a link directly either', exp1 < now() + interval '2 hours');

  -- ===== arriving =====
  perform pg_temp.sw(a);
  perform public.finish_trip_share_link(lid, true);
  perform pg_temp.anon();
  select * into r from public.get_shared_location(tok);
  msg := msg || pg_temp.ok('after you arrive the page says so...', r.trip_status = 'arrived' and r.first_name = 'Alex');
  msg := msg || pg_temp.ok('...and no longer shows where you are', r.latitude is null and r.longitude is null and r.recorded_at is null and r.battery_level is null);
  perform pg_temp.su();
  select expires_at into exp1 from public.share_links where id = lid;
  msg := msg || pg_temp.ok('...for 15 more minutes, then it ends', exp1 <= now() + interval '15 minutes');
  perform pg_temp.sw(a);
  perform public.update_trip_share_link(lid, now() + interval '2 hours');
  perform pg_temp.su();
  select trip_status into plain from public.share_links where id = lid;
  msg := msg || pg_temp.ok('an arrived trip cannot be restarted by an update', plain = 'arrived');

  -- ===== stopping without arriving =====
  perform pg_temp.sw(a);
  select x.id, x.token into lid2, plain from public.create_trip_share_link('Gym', now() + interval '15 minutes', 'walk') x;
  perform public.finish_trip_share_link(lid2, false);
  perform pg_temp.anon();
  select count(*) into n from public.get_shared_location(plain);
  msg := msg || pg_temp.ok('stopping navigation ends the link at once', n = 0);

  -- ===== validation, limits, plain links =====
  perform pg_temp.sw(a);
  begin perform public.create_trip_share_link('  ', now() + interval '10 minutes', 'drive'); msg := msg || pg_temp.ok('empty destination refused', false);
  exception when others then msg := msg || pg_temp.ok('empty destination refused', true); end;
  begin perform public.create_trip_share_link('X', now() + interval '10 minutes', 'rocket'); msg := msg || pg_temp.ok('unknown mode refused', false);
  exception when others then msg := msg || pg_temp.ok('unknown mode refused', true); end;
  begin perform public.create_trip_share_link('X', now() - interval '1 hour', 'drive'); msg := msg || pg_temp.ok('an ETA in the past refused', false);
  exception when others then msg := msg || pg_temp.ok('an ETA in the past refused', true); end;
  begin perform public.create_trip_share_link('X', now() + interval '25 hours', 'drive'); msg := msg || pg_temp.ok('an ETA over a day away refused', false);
  exception when others then msg := msg || pg_temp.ok('an ETA over a day away refused', true); end;

  plain := public.create_share_link(60);
  perform pg_temp.anon();
  select * into r from public.get_shared_location(plain);
  msg := msg || pg_temp.ok('an ordinary guest link still works and has no trip', r.latitude = 35.84 and r.trip_destination is null and r.trip_status is null);

  perform pg_temp.sw(a);
  for i in 1..3 loop perform public.create_trip_share_link('Place ' || i, now() + interval '30 minutes', 'drive'); end loop;
  begin perform public.create_trip_share_link('One too many', now() + interval '30 minutes', 'drive');
    msg := msg || pg_temp.ok('trip links count toward the 5-active-links limit', false);
  exception when others then msg := msg || pg_temp.ok('trip links count toward the 5-active-links limit', sqlerrm like '%5 active links%'); end;

  -- ===== function surface =====
  perform pg_temp.su();
  select count(*) into n from pg_proc where proname = 'get_shared_location' and pronamespace = 'public'::regnamespace;
  msg := msg || pg_temp.ok('one get_shared_location (no stale overload)', n = 1);
  msg := msg || pg_temp.ok('anonymous visitors can read a link',
    has_function_privilege('anon', 'public.get_shared_location(text)', 'execute'));
  msg := msg || pg_temp.ok('...but not create, update or finish one',
    not has_function_privilege('anon', 'public.create_trip_share_link(text,timestamptz,text)', 'execute')
    and not has_function_privilege('anon', 'public.update_trip_share_link(uuid,timestamptz)', 'execute')
    and not has_function_privilege('anon', 'public.finish_trip_share_link(uuid,boolean)', 'execute'));

  raise exception E'RESULT\n%', msg;
end $$;
