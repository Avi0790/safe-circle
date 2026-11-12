-- Location heading (migration ...000079). Rolls itself back; results in the
-- error text.
create function pg_temp.sw(u uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(label text, cond boolean) returns text language sql as $$
  select case when cond is true then 'PASS ' else 'FAIL ' end || label || E'\n'
$$;
create function pg_temp.err(sql text) returns text language plpgsql as $$
begin execute sql; return null; exception when others then return sqlerrm; end $$;

do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000a1';
  b uuid := '00000000-0000-0000-0000-0000000000b1';
  h real; txt text; c uuid; code text;
  msg text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (a, 'a@test.invalid', '{"full_name":"Ann"}'), (b, 'b@test.invalid', '{"full_name":"Ben"}');
  perform pg_temp.sw(a);
  select x.circle_id, x.invite_code into c, code from public.create_circle('Fam') x;
  perform pg_temp.sw(b); perform public.redeem_invite_code(code);

  perform pg_temp.sw(a);
  insert into public.locations (latitude, longitude, speed, heading, recorded_at) values (35.84, -90.70, 12, 271.5, now() - interval '1 minute');
  insert into public.locations (latitude, longitude, speed, heading) values (35.85, -90.70, 0, null);
  select heading into h from public.latest_locations where user_id = a;
  msg := msg || pg_temp.ok('the newest position wins, still without a heading', h is null);
  txt := pg_temp.err('insert into public.locations (latitude, longitude, heading) values (35.8, -90.7, 400)');
  msg := msg || pg_temp.ok('a heading must be 0 to 360', txt is not null);
  txt := pg_temp.err('insert into public.locations (latitude, longitude) values (35.8, -90.7)');
  msg := msg || pg_temp.ok('a ping without a heading still works (older apps)', txt is null);

  -- now() is fixed for the whole transaction: a later time, so it's the newest
  insert into public.locations (latitude, longitude, speed, heading, recorded_at) values (35.86, -90.70, 12, 90, now() + interval '1 minute');
  perform pg_temp.sw(b);
  select heading into h from public.latest_locations where user_id = a;
  msg := msg || pg_temp.ok('a circle-mate sees the heading with the position', h = 90);

  raise exception E'RESULT\n%', msg;
end $$;
