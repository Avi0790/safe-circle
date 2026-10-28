-- Curfew in the person's own time zone (migration ...000070). Uses zones far
-- from UTC on both sides, where comparing with UTC (the old behaviour) gets
-- the answer wrong: Pacific/Kiritimati is UTC+14, Pacific/Pago_Pago UTC-11.
-- Rolls itself back; results in the error text.
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
  circ uuid; code text; home uuid;
  ahead timestamp := now() at time zone 'Pacific/Kiritimati';
  behind timestamp := now() at time zone 'Pacific/Pago_Pago';
  d date; z text; txt text;
  msg text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (a,'a@test.invalid','{"full_name":"A Teen"}'), (b,'b@test.invalid','{"full_name":"B Parent"}');
  perform pg_temp.sw(a);
  select x.circle_id, x.invite_code into circ, code from public.create_circle('Family') x;
  perform pg_temp.sw(b);
  perform public.redeem_invite_code(code);
  perform pg_temp.su();
  insert into public.places (circle_id, name, latitude, longitude, radius_meters, created_by)
  values (circ, 'Home', 35.84, -90.70, 150, a) returning id into home;

  -- ===== a curfew that has passed locally, but not in UTC =====
  -- (a minute ago in Kiritimati is about 14 hours from now in UTC)
  if ahead::time > '00:05' then
    perform pg_temp.sw(a);
    perform public.set_curfew(home, (ahead - interval '1 minute')::time, 'Pacific/Kiritimati');
    perform pg_temp.su();
    perform public.check_curfews();
    select last_alerted_date, time_zone into d, z from public.curfews where user_id = a;
    msg := msg || pg_temp.ok('passed in their time zone: the circle is alerted (UTC would have waited ~14 h)', d is not null);
    msg := msg || pg_temp.ok('...and "alerted today" is their local date', d = ahead::date and z = 'Pacific/Kiritimati');
    perform public.check_curfews();
    select last_alerted_date into d from public.curfews where user_id = a;
    msg := msg || pg_temp.ok('a second check the same local day does not alert again', d = ahead::date);
  else
    msg := msg || 'PASS (skipped: just after midnight in Kiritimati)' || E'\n';
  end if;

  -- ===== a curfew still ahead locally, though long past in UTC =====
  if behind::time < '23:00' then
    perform pg_temp.sw(a);
    perform public.set_curfew(home, (behind + interval '30 minutes')::time, 'Pacific/Pago_Pago');
    perform pg_temp.su();
    perform public.check_curfews();
    select last_alerted_date into d from public.curfews where user_id = a;
    msg := msg || pg_temp.ok('not yet in their time zone: no alert (UTC would have alerted already)', d is null);
  else
    msg := msg || 'PASS (skipped: late evening in Pago Pago)' || E'\n';
  end if;

  -- ===== at home by curfew: no alert =====
  if ahead::time > '00:05' then
    perform pg_temp.sw(a);
    perform public.set_curfew(home, (ahead - interval '1 minute')::time, 'Pacific/Kiritimati');
    perform pg_temp.su();
    insert into public.place_membership_state (place_id, user_id, is_inside)
    values (home, a, true)
    on conflict (place_id, user_id) do update set is_inside = true;
    perform public.check_curfews();
    select last_alerted_date into d from public.curfews where user_id = a;
    msg := msg || pg_temp.ok('home in time: no alert', d is null);
    delete from public.place_membership_state where place_id = home and user_id = a;
  end if;

  -- ===== the zone is checked, and older apps still work =====
  perform pg_temp.sw(a);
  txt := null;
  begin perform public.set_curfew(home, '22:00', 'Mars/Olympus_Mons'); exception when others then txt := sqlerrm; end;
  msg := msg || pg_temp.ok('an unknown time zone is refused', txt like 'Unknown time zone%');
  perform public.set_curfew(p_place_id => home, p_curfew_time => '22:00');
  perform pg_temp.su();
  select time_zone into z from public.curfews where user_id = a;
  msg := msg || pg_temp.ok('an app that sends no zone (older versions) gets UTC, as before', z = 'UTC');
  perform pg_temp.sw(a);
  perform public.set_curfew(home, '22:00', 'America/Chicago');
  perform pg_temp.su();
  select time_zone into z from public.curfews where user_id = a;
  msg := msg || pg_temp.ok('saving again with the phone''s zone stores it', z = 'America/Chicago');

  -- ===== still private =====
  perform pg_temp.sw(b);
  select count(*)::text into txt from public.curfews where user_id = a;
  msg := msg || pg_temp.ok('a circle-mate still can''t read someone''s curfew', txt = '0');

  perform pg_temp.su();
  raise exception E'RESULT\n%', msg;
end $$;
