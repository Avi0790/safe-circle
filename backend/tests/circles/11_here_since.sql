-- "Here since" (migration ...000080). Rolls itself back; results in the
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

do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000a1';
  b uuid := '00000000-0000-0000-0000-0000000000b1';
  x uuid := '00000000-0000-0000-0000-0000000000c1';
  c uuid; code text; since timestamptz;
  msg text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (a, 'a@test.invalid', '{"full_name":"Ann"}'), (b, 'b@test.invalid', '{"full_name":"Ben"}'),
    (x, 'x@test.invalid', '{"full_name":"Out"}');
  perform pg_temp.sw(a);
  select r.circle_id, r.invite_code into c, code from public.create_circle('Fam') r;
  perform pg_temp.sw(b); perform public.redeem_invite_code(code);

  -- Ann drove across town, then has been at one spot (moving a few metres) for 40 minutes
  perform pg_temp.sw(a);
  insert into public.locations (latitude, longitude, recorded_at) values
    (35.800, -90.700, now() - interval '90 minutes'),
    (35.820, -90.700, now() - interval '50 minutes'),
    (35.840, -90.700, now() - interval '40 minutes'),
    (35.8401, -90.7001, now() - interval '20 minutes'),
    (35.8400, -90.7002, now() - interval '1 minute');

  perform pg_temp.sw(b);
  since := public.here_since(a);
  msg := msg || pg_temp.ok('a circle-mate sees when Ann arrived (40 min ago)', since = now() - interval '40 minutes');

  perform pg_temp.sw(a);
  perform public.hide_from(b);
  perform pg_temp.sw(b);
  msg := msg || pg_temp.ok('ghost mode hides it too', public.here_since(a) is null);

  perform pg_temp.sw(x);
  msg := msg || pg_temp.ok('an outsider gets nothing', public.here_since(a) is null);

  perform pg_temp.sw(a);
  msg := msg || pg_temp.ok('and Ann sees her own', public.here_since(a) = now() - interval '40 minutes');

  raise exception E'RESULT\n%', msg;
end $$;
