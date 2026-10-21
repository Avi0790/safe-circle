-- Former workers stay on timesheets (migration ...000065): owners and admins
-- still see the times of shifts worked by people who have left; managers,
-- other organizations and the former worker's ex-colleagues don't; and
-- nobody sees where a former worker was. Also: the disclosure bump asks
-- current workers to accept again. Rolls itself back; results in the error.
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
  o  uuid := '00000000-0000-0000-0000-0000000000a0';
  ad uuid := '00000000-0000-0000-0000-0000000000a1';
  m1 uuid := '00000000-0000-0000-0000-0000000000b1';
  w1 uuid := '00000000-0000-0000-0000-0000000000c1';
  w2 uuid := '00000000-0000-0000-0000-0000000000c2';
  ob uuid := '00000000-0000-0000-0000-0000000000e0';
  org uuid; orgb uuid; code text; codeb text; team uuid; r uuid;
  n int; n2 int; b boolean; txt text;
  t timestamptz := now(); msg text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (o,'o@test.invalid','{"full_name":"A Owner"}'), (ad,'ad@test.invalid','{"full_name":"B Admin"}'),
    (m1,'m1@test.invalid','{"full_name":"C Lead"}'), (w1,'w1@test.invalid','{"full_name":"E Leaver"}'),
    (w2,'w2@test.invalid','{"full_name":"F Stayer"}'), (ob,'ob@test.invalid','{"full_name":"X Other"}');

  perform pg_temp.sw(o);
  select c.org_id, c.invite_code into org, code from public.create_organization('Crew') c;
  foreach r in array array[ad, m1, w1, w2] loop
    perform pg_temp.sw(r);
    perform public.redeem_org_invite_code(code);
    perform public.accept_org_consent(org);
  end loop;
  perform pg_temp.sw(o);
  perform public.set_org_member_role(org, ad, 'admin');
  perform public.set_org_member_role(org, m1, 'manager');
  team := public.create_team(org, 'A');
  perform public.set_team_member(team, m1, true);
  perform public.set_team_member(team, w1, false);
  perform public.set_team_member(team, w2, false);
  perform pg_temp.sw(ob);
  select c.org_id, c.invite_code into orgb, codeb from public.create_organization('Other') c;

  -- a finished shift each, with positions recorded during w1's
  perform pg_temp.su();
  insert into public.shifts (org_id, user_id, clocked_in_at, clocked_out_at) values
    (org, w1, t - interval '6 hours', t - interval '2 hours'),
    (org, w2, t - interval '5 hours', t - interval '1 hour');
  insert into public.locations (user_id, latitude, longitude, recorded_at) values
    (w1, 10, 10, t - interval '4 hours');

  -- ===== the disclosure bump =====
  msg := msg || pg_temp.ok('disclosure is version 4', public.org_disclosure_version() = 4);
  perform pg_temp.sw(w2);
  select needs_reconsent into b from public.my_orgs();
  msg := msg || pg_temp.ok('workers who joined just now accepted version 4 (no re-accept)', b = false);
  perform pg_temp.su();
  update public.org_members set consent_version = 3 where user_id = w2;
  perform pg_temp.sw(w2);
  select needs_reconsent into b from public.my_orgs();
  msg := msg || pg_temp.ok('a worker who accepted version 3 is asked again', b = true);
  txt := null;
  begin perform public.clock_in(org); exception when others then txt := sqlerrm; end;
  msg := msg || pg_temp.ok('...and can''t clock in until they do', txt like '%disclosure was updated%');
  perform public.accept_org_consent(org);
  select needs_reconsent into b from public.my_orgs();
  msg := msg || pg_temp.ok('accepting again clears it', b = false);

  -- ===== before anyone leaves =====
  perform pg_temp.sw(o);
  select count(*), count(*) filter (where is_current) into n, n2 from public.org_shifts(org, 7, 100);
  msg := msg || pg_temp.ok('owner sees both shifts, both current workers', n = 2 and n2 = 2);

  -- ===== w1 leaves =====
  perform pg_temp.sw(w1);
  perform public.leave_org(org);

  perform pg_temp.sw(o);
  select count(*) into n from public.org_shifts(org, 7, 100) where user_id = w1 and not is_current;
  msg := msg || pg_temp.ok('owner still sees the leaver''s shift, marked as no longer current', n = 1);
  select count(*) into n from public.org_shifts(org, 7, 100) where user_id = w2 and is_current;
  msg := msg || pg_temp.ok('...and the current worker''s, marked current', n = 1);
  perform pg_temp.sw(ad);
  select count(*) into n from public.org_shifts(org, 7, 100) where user_id = w1;
  msg := msg || pg_temp.ok('an admin sees the leaver''s shift too', n = 1);
  perform pg_temp.sw(m1);
  select count(*) into n from public.org_shifts(org, 7, 100) where user_id = w1;
  select count(*) into n2 from public.org_shifts(org, 7, 100) where user_id = w2;
  msg := msg || pg_temp.ok('a manager no longer sees the leaver (team membership ended), still sees the stayer', n = 0 and n2 = 1);
  perform pg_temp.sw(w2);
  select count(*) into n from public.org_shifts(org, 7, 100);
  msg := msg || pg_temp.ok('a worker sees nobody''s shifts', n = 0);
  perform pg_temp.sw(ob);
  select count(*) into n from public.org_shifts(org, 7, 100);
  msg := msg || pg_temp.ok('another organization''s owner sees none of them', n = 0);
  perform pg_temp.sw(w1);
  select count(*) into n from public.org_shifts(org, 7, 100);
  msg := msg || pg_temp.ok('the leaver can''t read the organization''s shifts', n = 0);

  -- ===== but never where the leaver was =====
  perform pg_temp.sw(o);
  select count(*) into n from public.org_worker_track(org, w1, t - interval '12 hours', t);
  msg := msg || pg_temp.ok('the owner can''t pull the leaver''s positions, even from a shift they worked', n = 0);
  select count(*) into n from public.org_live_roster(org) where user_id = w1;
  msg := msg || pg_temp.ok('the leaver isn''t on the live crew', n = 0);
  select count(*) into n from public.locations where user_id = w1;
  msg := msg || pg_temp.ok('the owner can''t read the leaver''s locations directly', n = 0);

  -- ===== removed (not left) works the same =====
  perform pg_temp.sw(o);
  perform public.remove_org_member(org, w2);
  select count(*), count(*) filter (where not is_current) into n, n2 from public.org_shifts(org, 7, 100);
  msg := msg || pg_temp.ok('after removing the other worker, both shifts are still listed as former', n = 2 and n2 = 2);

  -- ===== nothing older than 90 days =====
  perform pg_temp.su();
  insert into public.shifts (org_id, user_id, clocked_in_at, clocked_out_at) values
    (org, w1, t - interval '100 days', t - interval '100 days' + interval '8 hours');
  perform pg_temp.sw(o);
  select count(*) into n from public.org_shifts(org, 90, 500) where user_id = w1;
  msg := msg || pg_temp.ok('a shift from 100 days ago is never listed', n = 1);

  perform pg_temp.su();
  raise exception E'RESULT\n%', msg;
end $$;
