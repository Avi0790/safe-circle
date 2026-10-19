-- Shared trips can be a drive or a walk (migration ...000059). Self-rolling-back:
-- run with `supabase db query --linked -f tests/circles/03_walk_trips.sql`; the
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
  circ uuid; code text; r uuid; t1 uuid; t2 uuid; t3 uuid; q bigint; n int; m text; txt text;
  msg text := '';
  eta timestamptz := now() + interval '20 minutes';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (a,'a@test.invalid','{"full_name":"A Walker"}'), (b,'b@test.invalid','{"full_name":"B Mate"}'),
    (c,'c@test.invalid','{"full_name":"C Hidden"}');
  perform pg_temp.sw(a);
  select x.circle_id, x.invite_code into circ, code from public.create_circle('Family') x;
  foreach r in array array[b, c] loop
    perform pg_temp.sw(r); perform public.redeem_invite_code(code);
  end loop;
  perform pg_temp.sw(a);
  perform public.hide_from(c);

  -- ===== a walk =====
  perform pg_temp.su();
  select coalesce(max(id), 0) into q from net.http_request_queue;
  perform pg_temp.sw(a);
  t1 := public.start_shared_trip(circ, 'City Library', eta, 'walk');
  select mode into m from public.shared_trips where id = t1;
  msg := msg || pg_temp.ok('a walk can be shared and is stored as a walk', m = 'walk');
  perform pg_temp.sw(b);
  select mode into m from public.shared_trips where id = t1;
  msg := msg || pg_temp.ok('a circle-mate sees that it is a walk', m = 'walk');
  perform pg_temp.sw(c); select count(*) into n from public.shared_trips where id = t1;
  msg := msg || pg_temp.ok('someone hidden from still cannot see it', n = 0);
  perform pg_temp.su();
  txt := pg_temp.pushed(q, '🚶');
  msg := msg || pg_temp.ok('the push says walking and reaches only the circle-mate [' || txt || ']',
    txt like 'B Mate :: Walking to City Library, arriving in about % min.');
  msg := msg || pg_temp.ok('...and there is no driving push', pg_temp.pushed(q, '🚗') = '(none)');

  -- ===== a drive (explicit and by default) =====
  perform pg_temp.su();
  select coalesce(max(id), 0) into q from net.http_request_queue;
  perform pg_temp.sw(a);
  t2 := public.start_shared_trip(circ, 'Walmart', eta, 'drive');
  select mode into m from public.shared_trips where id = t2;
  msg := msg || pg_temp.ok('an explicit drive is stored as a drive', m = 'drive');
  perform pg_temp.su();
  txt := pg_temp.pushed(q, '🚗');
  msg := msg || pg_temp.ok('the drive push still says heading to [' || txt || ']', txt like 'B Mate :: Heading to Walmart%');
  select count(*) into n from public.shared_trips where id = t1 and status = 'ended';
  msg := msg || pg_temp.ok('starting a drive ends the walk (one active trip)', n = 1);

  perform pg_temp.sw(a);
  t3 := public.start_shared_trip(circ, 'Gym', eta);   -- an older app: three arguments
  select mode into m from public.shared_trips where id = t3;
  msg := msg || pg_temp.ok('an app that sends no mode still works, as a drive', m = 'drive');

  -- ===== validation =====
  begin perform public.start_shared_trip(circ, 'X', eta, 'run'); msg := msg || pg_temp.ok('unknown mode refused', false);
  exception when others then msg := msg || pg_temp.ok('unknown mode refused', sqlerrm like 'Choose driving or walking%'); end;
  begin perform public.start_shared_trip(circ, 'X', eta, 'WALK'); msg := msg || pg_temp.ok('mode is case-sensitive, not guessed', false);
  exception when others then msg := msg || pg_temp.ok('mode is case-sensitive, not guessed', true); end;
  begin perform public.start_shared_trip(circ, 'X', eta, null); msg := msg || pg_temp.ok('null mode refused', false);
  exception when others then msg := msg || pg_temp.ok('null mode refused', true); end;
  begin perform public.start_shared_trip(circ, '', eta, 'walk'); msg := msg || pg_temp.ok('empty destination still refused for a walk', false);
  exception when others then msg := msg || pg_temp.ok('empty destination still refused for a walk', true); end;

  -- ===== cannot be edited directly, and arriving works for walks =====
  perform pg_temp.sw(a);
  t1 := public.start_shared_trip(circ, 'Park', eta, 'walk');
  begin update public.shared_trips set mode = 'drive' where id = t1; exception when others then null; end;
  select mode into m from public.shared_trips where id = t1;
  msg := msg || pg_temp.ok('the mode cannot be changed directly', m = 'walk');
  perform pg_temp.su();
  select coalesce(max(id), 0) into q from net.http_request_queue;
  perform pg_temp.sw(a);
  perform public.end_shared_trip(t1, true);
  perform pg_temp.su();
  txt := pg_temp.pushed(q, '✅');
  msg := msg || pg_temp.ok('arriving from a walk tells the circle-mate [' || txt || ']', txt = 'B Mate :: They got to Park.');

  -- ===== the function surface =====
  select count(*) into n from pg_proc where proname = 'start_shared_trip' and pronamespace = 'public'::regnamespace;
  msg := msg || pg_temp.ok('only one start_shared_trip exists (no unvalidated overload)', n = 1);
  msg := msg || pg_temp.ok('signed-in users can call it',
    has_function_privilege('authenticated', 'public.start_shared_trip(uuid,text,timestamptz,text)', 'execute'));
  msg := msg || pg_temp.ok('anonymous callers cannot',
    not has_function_privilege('anon', 'public.start_shared_trip(uuid,text,timestamptz,text)', 'execute'));

  perform pg_temp.su();
  raise exception E'RESULT\n%', msg;
end $$;
