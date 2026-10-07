create function pg_temp.sw(u uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.su() returns void language plpgsql as $$
begin
  execute 'reset role';
end $$;

create function pg_temp.ok(label text, cond boolean) returns text language sql as $$
  select case when cond is true then 'PASS ' else 'FAIL ' end || label || E'\n'
$$;

do $$
declare
  o  uuid := '00000000-0000-0000-0000-0000000000a0';
  ad uuid := '00000000-0000-0000-0000-0000000000a1';
  m1 uuid := '00000000-0000-0000-0000-0000000000b1';
  m2 uuid := '00000000-0000-0000-0000-0000000000b2';
  w1 uuid := '00000000-0000-0000-0000-0000000000c1';
  w2 uuid := '00000000-0000-0000-0000-0000000000c2';
  w3 uuid := '00000000-0000-0000-0000-0000000000c3';
  x  uuid := '00000000-0000-0000-0000-0000000000d1';
  org uuid; org2 uuid; code text; code2 text; rc uuid;
  team1 uuid; team2 uuid;
  t timestamptz := now();
  msg text := '';
  n int; n2 int; lat double precision; txt text; b boolean;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (o,  'o@test.invalid',  '{"full_name":"Owner"}'),
    (ad, 'ad@test.invalid', '{"full_name":"Admin"}'),
    (m1, 'm1@test.invalid', '{"full_name":"Manager One"}'),
    (m2, 'm2@test.invalid', '{"full_name":"Manager Two"}'),
    (w1, 'w1@test.invalid', '{"full_name":"Worker One"}'),
    (w2, 'w2@test.invalid', '{"full_name":"Worker Two"}'),
    (w3, 'w3@test.invalid', '{"full_name":"Worker Three"}'),
    (x,  'x@test.invalid',  '{"full_name":"Outsider"}');

  -- ===== setup through the real functions =====
  perform pg_temp.sw(o);
  select c.org_id, c.invite_code into org, code from public.create_organization('Test Crew') c;

  perform pg_temp.sw(x);
  rc := public.redeem_org_invite_code('ZZZZZZ');
  msg := msg || pg_temp.ok('invalid code returns null, no membership', rc is null);

  foreach rc in array array[ad, m1, m2, w1, w2] loop
    perform pg_temp.sw(rc);
    perform public.redeem_org_invite_code(code);
    perform public.accept_org_consent(org);
  end loop;
  perform pg_temp.sw(w3);
  perform public.redeem_org_invite_code(code);   -- redeemed, NOT consented

  select count(*) into n from public.my_orgs() where status = 'invited';
  msg := msg || pg_temp.ok('w3 sees own pending invitation via my_orgs', n = 1);

  perform pg_temp.sw(o);
  perform public.set_org_member_role(org, ad, 'admin');
  perform public.set_org_member_role(org, m1, 'manager');
  perform public.set_org_member_role(org, m2, 'manager');
  team1 := public.create_team(org, 'Crew A');
  team2 := public.create_team(org, 'Crew B');
  perform public.set_team_member(team1, m1, true);
  perform public.set_team_member(team1, w1, false);
  perform public.set_team_member(team2, m2, true);

  -- ===== fixtures: shifts and pings written as superuser =====
  perform pg_temp.su();
  insert into public.shifts (org_id, user_id, clocked_in_at, clocked_out_at)
  values (org, w1, t - interval '10 hours', t - interval '6 hours');
  insert into public.locations (user_id, latitude, longitude, speed, recorded_at) values
    (w1, 1, 1, 0, t - interval '11 hours'),   -- personal time, before shift
    (w1, 2, 2, 0, t - interval '9 hours'),    -- in old shift
    (w1, 3, 3, 0, t - interval '7 hours'),    -- in old shift
    (w1, 4, 4, 0, t - interval '5 hours'),    -- personal, after old shift
    (w2, 8, 8, 0, t - interval '5 minutes');  -- w2 off shift

  -- ===== clock-in rules =====
  perform pg_temp.sw(w3);
  begin
    perform public.clock_in(org);
    msg := msg || 'FAIL unconsented worker could clock in' || E'\n';
  exception when others then
    msg := msg || 'PASS unconsented worker cannot clock in' || E'\n';
  end;
  perform pg_temp.sw(m1);
  begin
    perform public.clock_in(org);
    msg := msg || 'FAIL manager could clock in' || E'\n';
  exception when others then
    msg := msg || 'PASS manager cannot clock in' || E'\n';
  end;

  perform pg_temp.sw(w1);
  perform public.clock_in(org);
  begin
    perform public.clock_in(org);
    msg := msg || 'FAIL double clock-in allowed' || E'\n';
  exception when others then
    msg := msg || 'PASS double clock-in blocked' || E'\n';
  end;

  perform pg_temp.su();
  update public.shifts set clocked_in_at = t - interval '2 hours'
   where user_id = w1 and clocked_out_at is null;
  insert into public.locations (user_id, latitude, longitude, speed, recorded_at) values
    (w1, 5, 5, 0, t - interval '3 hours'),     -- personal, before this clock-in
    (w1, 6, 6, 0, t - interval '90 minutes'),
    (w1, 7, 7, 0, t - interval '10 minutes');

  -- ===== live roster: who sees whom =====
  perform pg_temp.sw(ad);
  select count(*), max(latitude) into n, lat from public.org_live_roster(org);
  msg := msg || pg_temp.ok('admin sees exactly the on-shift worker', n = 1);
  msg := msg || pg_temp.ok('admin sees latest in-shift ping (7), not personal ones', lat = 7);

  perform pg_temp.sw(m1);
  select count(*) into n from public.org_live_roster(org);
  msg := msg || pg_temp.ok('manager leading w1''s team sees w1', n = 1);

  perform pg_temp.sw(m2);
  select count(*) into n from public.org_live_roster(org);
  msg := msg || pg_temp.ok('manager of another team sees nobody', n = 0);

  perform pg_temp.sw(w2);
  select count(*) into n from public.org_live_roster(org);
  msg := msg || pg_temp.ok('worker sees no teammates', n = 0);
  perform pg_temp.sw(w1);
  select count(*) into n from public.org_live_roster(org);
  msg := msg || pg_temp.ok('on-shift worker sees no roster either', n = 0);
  perform pg_temp.sw(x);
  select count(*) into n from public.org_live_roster(org);
  msg := msg || pg_temp.ok('outsider sees nobody', n = 0);

  -- ===== no direct door into locations =====
  perform pg_temp.sw(ad);
  select count(*) into n from public.locations where user_id = w1;
  msg := msg || pg_temp.ok('admin cannot read locations directly', n = 0);
  perform pg_temp.sw(m1);
  select count(*) into n from public.locations where user_id = w1;
  msg := msg || pg_temp.ok('manager cannot read locations directly', n = 0);
  select count(*) into n from public.latest_locations where user_id = w1;
  msg := msg || pg_temp.ok('manager cannot read latest_locations directly', n = 0);
  perform pg_temp.sw(w1);
  select count(*) into n from public.locations where user_id = w1;
  msg := msg || pg_temp.ok('worker still reads their own history', n = 7);

  -- ===== track: shift windows only =====
  perform pg_temp.sw(ad);
  select count(*), count(*) filter (where latitude in (1, 4, 5)) into n, n2
  from public.org_worker_track(org, w1, t - interval '12 hours', t);
  msg := msg || pg_temp.ok('track returns the 4 in-shift pings (2,3,6,7)', n = 4);
  msg := msg || pg_temp.ok('track never returns personal-time pings (1,4,5)', n2 = 0);

  select count(*) into n from public.org_shifts(org);
  msg := msg || pg_temp.ok('org_shifts lists w1''s two shifts', n = 2);
  select count(*) into n from public.org_worker_track(org, w2, t - interval '12 hours', t);
  msg := msg || pg_temp.ok('track on a worker with no shifts is empty', n = 0);
  perform pg_temp.sw(m2);
  select count(*) into n from public.org_worker_track(org, w1, t - interval '12 hours', t);
  msg := msg || pg_temp.ok('manager of another team cannot pull w1''s track', n = 0);

  -- ===== audit =====
  perform pg_temp.sw(ad);
  perform count(*) from public.org_live_roster(org);   -- second look inside 15 min
  perform pg_temp.sw(w1);
  select count(*) filter (where action = 'viewed_live' and actor_id = ad),
         count(*) filter (where action = 'viewed_track' and actor_id = ad)
    into n, n2 from public.org_audit where target_id = w1;
  msg := msg || pg_temp.ok('w1 can read that the admin viewed them live (once, deduped)', n = 1);
  msg := msg || pg_temp.ok('w1 can read that their track was pulled', n2 = 1);
  perform pg_temp.sw(w2);
  select count(*) into n from public.org_audit where target_id = w1;
  msg := msg || pg_temp.ok('w2 cannot see audit rows about w1', n = 0);

  -- ===== clock out: nothing visible after, past shifts still windowed =====
  perform pg_temp.sw(w1);
  perform public.clock_out();
  perform pg_temp.su();
  update public.shifts set clocked_out_at = t - interval '30 minutes'
   where user_id = w1 and clocked_in_at = t - interval '2 hours';

  perform pg_temp.sw(ad);
  select count(*) into n from public.org_live_roster(org);
  msg := msg || pg_temp.ok('after clock-out the worker is off the live roster', n = 0);
  select count(*), count(*) filter (where latitude = 7) into n, n2
  from public.org_worker_track(org, w1, t - interval '12 hours', t);
  msg := msg || pg_temp.ok('after clock-out only in-shift pings (2,3,6) remain', n = 3);
  msg := msg || pg_temp.ok('ping after clock-out (7) is excluded', n2 = 0);

  -- ===== stale shift =====
  perform pg_temp.sw(w2);
  perform public.clock_in(org);
  perform pg_temp.su();
  update public.shifts set clocked_in_at = t - interval '15 hours'
   where user_id = w2 and clocked_out_at is null;
  perform pg_temp.sw(ad);
  select count(*) into n from public.org_live_roster(org);
  msg := msg || pg_temp.ok('a shift open past 14h is invisible even before cleanup', n = 0);
  perform pg_temp.su();
  select public.close_stale_shifts() into n;
  msg := msg || pg_temp.ok('close_stale_shifts closes it', n = 1);
  perform pg_temp.sw(w2);
  perform public.clock_in(org);
  msg := msg || pg_temp.ok('worker can clock in again after a stale shift', true);
  perform public.clock_out();

  -- ===== role and permission guards =====
  perform pg_temp.sw(ad);
  begin
    perform public.set_org_member_role(org, o, 'worker');
    msg := msg || 'FAIL admin demoted the owner' || E'\n';
  exception when others then msg := msg || 'PASS admin cannot change the owner' || E'\n'; end;
  begin
    perform public.set_org_member_role(org, m1, 'admin');
    msg := msg || 'FAIL admin promoted someone to admin' || E'\n';
  exception when others then msg := msg || 'PASS admin cannot mint admins' || E'\n'; end;
  begin
    perform public.set_team_member(team1, w2, true);
    msg := msg || 'FAIL a worker was made team lead' || E'\n';
  exception when others then msg := msg || 'PASS only a manager can lead a team' || E'\n'; end;

  perform pg_temp.sw(w1);
  begin
    perform public.set_org_member_role(org, w1, 'owner');
    msg := msg || 'FAIL worker escalated themselves' || E'\n';
  exception when others then msg := msg || 'PASS worker cannot change roles' || E'\n'; end;
  begin
    perform public.regenerate_org_invite_code(org);
    msg := msg || 'FAIL worker regenerated the invite code' || E'\n';
  exception when others then msg := msg || 'PASS worker cannot regenerate the code' || E'\n'; end;

  perform pg_temp.sw(m1);
  begin
    perform public.remove_org_member(org, w1);
    msg := msg || 'FAIL manager removed a worker' || E'\n';
  exception when others then msg := msg || 'PASS manager cannot remove people' || E'\n'; end;
  select count(*) into n from public.org_members;
  msg := msg || pg_temp.ok('manager reads only their own membership row directly', n = 1);

  perform pg_temp.sw(ad);
  select count(*) into n from public.org_members;
  msg := msg || pg_temp.ok('admin reads the whole membership list', n = 7);
  perform public.remove_org_member(org, w3);
  msg := msg || pg_temp.ok('admin can remove a worker', true);

  perform pg_temp.sw(o);
  begin
    perform public.leave_org(org);
    msg := msg || 'FAIL sole owner left' || E'\n';
  exception when others then msg := msg || 'PASS sole owner cannot leave' || E'\n'; end;

  -- ===== demoting a manager removes their view =====
  perform pg_temp.sw(ad);
  perform public.set_org_member_role(org, m1, 'worker');
  perform pg_temp.su();
  select count(*) into n from public.team_members where user_id = m1 and is_lead;
  msg := msg || pg_temp.ok('demoted manager no longer leads a team', n = 0);

  -- ===== leaving closes the shift and drops team rows =====
  perform pg_temp.sw(w1);
  perform public.clock_in(org);
  perform public.leave_org(org);
  perform pg_temp.su();
  select count(*) into n from public.shifts where user_id = w1 and clocked_out_at is null;
  msg := msg || pg_temp.ok('leaving closes the open shift', n = 0);
  select count(*) into n from public.team_members where user_id = w1;
  msg := msg || pg_temp.ok('leaving drops team membership', n = 0);
  select count(*) into n from public.org_members where user_id = w1;
  msg := msg || pg_temp.ok('leaving removes the membership', n = 0);

  -- ===== account deletion =====
  delete from auth.users where id = o;
  select role into txt from public.org_members where org_id = org and user_id = ad;
  msg := msg || pg_temp.ok('deleting the sole owner promotes the admin (org survives)', txt = 'owner');

  perform pg_temp.sw(x);
  select c.org_id, c.invite_code into org2, code2 from public.create_organization('Solo Crew') c;
  perform pg_temp.sw(w2);
  perform public.redeem_org_invite_code(code2);
  perform public.accept_org_consent(org2);
  perform pg_temp.su();
  delete from auth.users where id = x;
  select count(*) into n from public.organizations where id = org2;
  msg := msg || pg_temp.ok('owner deleted with only workers left removes the org', n = 0);

  -- ===== a manager must stay unable to pull workers they don't lead (final sanity) =====
  perform pg_temp.su();
  raise exception E'RESULT\n%', msg;
end $$;
