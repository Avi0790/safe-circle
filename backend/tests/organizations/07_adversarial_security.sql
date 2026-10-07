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
  wb uuid := '00000000-0000-0000-0000-0000000000e1';
  x  uuid := '00000000-0000-0000-0000-0000000000d1';
  org uuid; orgb uuid; code text; codeb text; team uuid; r uuid; e1 bigint; sid bigint;
  n int; n2 int; txt text; lat double precision; whom uuid; ts timestamptz; ok_count int;
  t timestamptz := now(); msg text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (o,'o@test.invalid','{"full_name":"A Owner"}'), (ad,'ad@test.invalid','{"full_name":"B Admin"}'),
    (m1,'m1@test.invalid','{"full_name":"C Lead"}'), (w1,'w1@test.invalid','{"full_name":"E Worker"}'),
    (w2,'w2@test.invalid','{"full_name":"F Other"}'), (ob,'ob@test.invalid','{"full_name":"H OwnerB"}'),
    (wb,'wb@test.invalid','{"full_name":"I WorkerB"}'), (x,'x@test.invalid','{"full_name":"G Outsider"}');

  perform pg_temp.sw(o);
  select c.org_id, c.invite_code into org, code from public.create_organization('Crew A') c;
  foreach r in array array[ad, m1, w1, w2] loop
    perform pg_temp.sw(r); perform public.redeem_org_invite_code(code); perform public.accept_org_consent(org);
  end loop;
  perform pg_temp.sw(o);
  perform public.set_org_member_role(org, ad, 'admin');
  perform public.set_org_member_role(org, m1, 'manager');
  team := public.create_team(org, 'T'); perform public.set_team_member(team, m1, true); perform public.set_team_member(team, w1, false);

  perform pg_temp.sw(ob);
  select c.org_id, c.invite_code into orgb, codeb from public.create_organization('Crew B') c;
  perform pg_temp.sw(wb); perform public.redeem_org_invite_code(codeb); perform public.accept_org_consent(orgb);

  perform pg_temp.su();
  insert into public.shifts (org_id, user_id, clocked_in_at) values (org, w1, t - interval '2 hours'), (orgb, wb, t - interval '2 hours');
  insert into public.locations (user_id, latitude, longitude, recorded_at) values (w1, 5, 5, t - interval '10 minutes'), (wb, 6, 6, t - interval '10 minutes');
  insert into public.sos_events (user_id, latitude, longitude, created_at) values (w1, 1, 1, t - interval '30 minutes') returning id into e1;

  -- ===== internal helpers must not be callable by a signed-in user =====
  perform pg_temp.sw(w2);
  begin perform public.org_log(org, ad, w1, 'viewed_live'); msg := msg || 'FAIL a worker forged an audit-log entry' || E'\n';
  exception when others then msg := msg || 'PASS a worker cannot write the audit log' || E'\n'; end;
  begin perform public.org_overseer_ids(org, w1); msg := msg || 'FAIL anyone can list who oversees a worker' || E'\n';
  exception when others then msg := msg || 'PASS overseer lists are not callable' || E'\n'; end;
  begin perform public.sos_org_recipients(w1, now()); msg := msg || 'FAIL anyone can list who an SOS would reach' || E'\n';
  exception when others then msg := msg || 'PASS SOS recipient lists are not callable' || E'\n'; end;
  perform pg_temp.sw(x);
  begin perform public.org_role_of(org, o); msg := msg || 'FAIL an outsider can look up anyone''s role' || E'\n';
  exception when others then msg := msg || 'PASS role lookups for other people are not callable' || E'\n'; end;
  begin perform public.org_can_see_worker(org, w1); msg := msg || 'FAIL visibility oracle callable' || E'\n';
  exception when others then msg := msg || 'PASS visibility oracle is not callable' || E'\n'; end;
  begin perform public.close_stale_shifts(); msg := msg || 'FAIL maintenance job callable' || E'\n';
  exception when others then msg := msg || 'PASS maintenance jobs are not callable' || E'\n'; end;

  -- ===== no direct writes to organization tables =====
  perform pg_temp.sw(w2);
  begin insert into public.shifts (org_id, user_id) values (org, w2); msg := msg || 'FAIL direct insert into shifts' || E'\n';
  exception when others then msg := msg || 'PASS cannot insert shifts directly' || E'\n'; end;
  begin insert into public.org_audit (org_id, actor_id, target_id, action) values (org, w2, w1, 'viewed_live'); msg := msg || 'FAIL direct insert into org_audit' || E'\n';
  exception when others then msg := msg || 'PASS cannot insert audit rows directly' || E'\n'; end;
  begin insert into public.org_members (org_id, user_id, role, status, consented_at) values (orgb, w2, 'owner', 'active', now()); msg := msg || 'FAIL joined another org as owner' || E'\n';
  exception when others then msg := msg || 'PASS cannot insert memberships directly' || E'\n'; end;
  begin insert into public.teams (org_id, name) values (org, 'x'); msg := msg || 'FAIL created a team directly' || E'\n';
  exception when others then msg := msg || 'PASS cannot insert teams directly' || E'\n'; end;
  update public.org_members set role = 'owner' where user_id = w2;
  get diagnostics n = row_count;
  msg := msg || pg_temp.ok('a worker cannot promote themselves by updating their row', n = 0);
  update public.org_members set consent_version = 99, status = 'active' where user_id = w2;
  get diagnostics n = row_count;
  msg := msg || pg_temp.ok('a worker cannot edit their own consent record directly', n = 0);
  delete from public.org_members where user_id = w1;
  get diagnostics n = row_count;
  msg := msg || pg_temp.ok('a worker cannot delete a colleague''s membership', n = 0);
  update public.shifts set clocked_out_at = now() where user_id = w1;
  get diagnostics n = row_count;
  msg := msg || pg_temp.ok('a worker cannot close a colleague''s shift', n = 0);
  select count(*) into n from public.org_members;
  msg := msg || pg_temp.ok('a worker reads only their own membership row, not the crew', n = 1);

  -- ===== organizations are isolated from each other =====
  perform pg_temp.sw(ad);
  select count(*) into n from public.org_roster(orgb);
  msg := msg || pg_temp.ok('admin of A cannot list B''s roster', n = 0);
  select count(*) into n from public.org_live_roster(orgb);
  msg := msg || pg_temp.ok('admin of A cannot see B''s live crew', n = 0);
  select count(*) into n from public.org_worker_track(orgb, wb, t - interval '1 day', t);
  msg := msg || pg_temp.ok('admin of A cannot pull a B worker''s track', n = 0);
  select count(*) into n from public.org_shifts(orgb);
  msg := msg || pg_temp.ok('admin of A cannot read B''s shifts', n = 0);
  begin perform public.set_org_member_role(orgb, wb, 'worker'); msg := msg || 'FAIL admin of A changed a role in B' || E'\n';
  exception when others then msg := msg || 'PASS admin of A cannot change roles in B' || E'\n'; end;
  begin perform public.create_team(orgb, 'sneaky'); msg := msg || 'FAIL admin of A created a team in B' || E'\n';
  exception when others then msg := msg || 'PASS admin of A cannot create teams in B' || E'\n'; end;
  begin perform public.regenerate_org_invite_code(orgb); msg := msg || 'FAIL admin of A rotated B''s invite code' || E'\n';
  exception when others then msg := msg || 'PASS admin of A cannot rotate B''s invite code' || E'\n'; end;
  select count(*) into n from public.organizations where id = orgb;
  msg := msg || pg_temp.ok('admin of A cannot read B''s organization row', n = 0);
  select count(*) into n from public.sos_events where user_id = wb;
  msg := msg || pg_temp.ok('admin of A cannot see B workers'' SOS', n = 0);

  -- ===== SOS records cannot be tampered with by the people who can see them =====
  perform pg_temp.sw(ad);
  begin
    update public.sos_events set latitude = 99, longitude = 99 where id = e1;
    get diagnostics n = row_count;
    msg := msg || pg_temp.ok('an overseer cannot rewrite an SOS location', n = 0);
  exception when others then msg := msg || 'PASS an overseer cannot rewrite an SOS location' || E'\n'; end;
  begin
    update public.sos_events set user_id = ad where id = e1;
    get diagnostics n = row_count;
    msg := msg || pg_temp.ok('an overseer cannot reassign an SOS to themselves', n = 0);
  exception when others then msg := msg || 'PASS an overseer cannot reassign an SOS' || E'\n'; end;
  begin
    update public.sos_events set message = 'tampered', created_at = t - interval '1 year' where id = e1;
    get diagnostics n = row_count;
    msg := msg || pg_temp.ok('an overseer cannot edit an SOS message or timestamp', n = 0);
  exception when others then msg := msg || 'PASS an overseer cannot edit an SOS message or timestamp' || E'\n'; end;
  begin
    update public.sos_events set resolved_at = now(), resolved_by = o where id = e1;
  exception when others then msg := msg || 'FAIL an overseer could not resolve an SOS at all' || E'\n'; end;
  perform pg_temp.su();
  select resolved_by into whom from public.sos_events where id = e1;
  msg := msg || pg_temp.ok('resolving records who really resolved it, not who the client claims', whom = ad);
  perform pg_temp.sw(ad);
  begin update public.sos_events set resolved_at = null, resolved_by = null where id = e1; exception when others then null; end;
  perform pg_temp.su();
  select resolved_at is not null into txt from public.sos_events where id = e1;
  msg := msg || pg_temp.ok('a resolved SOS cannot be quietly re-opened', txt::boolean);

  -- ===== SOS rate limit cannot be dodged with backdated timestamps =====
  perform pg_temp.sw(w2);
  insert into public.sos_events (latitude, longitude, created_at) values (1, 1, now() - interval '3 hours') returning id, created_at into sid, ts;
  msg := msg || pg_temp.ok('a client-chosen SOS timestamp is ignored (stored as now)', ts > t - interval '1 minute');
  ok_count := 1;
  for n in 1..6 loop
    begin
      insert into public.sos_events (latitude, longitude, created_at) values (1, 1, now() - interval '3 hours');
      ok_count := ok_count + 1;
    exception when others then null; end;
  end loop;
  msg := msg || pg_temp.ok('backdating cannot spam SOS past the 3-per-10-minutes limit (' || ok_count || ' got through)', ok_count <= 3);

  -- ===== moving into the worker role requires the person''s own acceptance =====
  perform pg_temp.sw(o);
  perform public.set_org_member_role(org, m1, 'worker');
  perform pg_temp.sw(ad);
  select status into txt from public.org_roster(org) where user_id = m1;
  msg := msg || pg_temp.ok('a manager demoted to worker is not trackable until they accept (status ' || coalesce(txt,'?') || ')', txt = 'invited');
  perform pg_temp.sw(o);
  perform public.set_org_member_role(org, ad, 'worker');
  perform pg_temp.sw(o);
  select status into txt from public.org_roster(org) where user_id = ad;
  msg := msg || pg_temp.ok('an admin demoted to worker is not trackable until they accept (status ' || coalesce(txt,'?') || ')', txt = 'invited');

  -- ===== a removed member loses everything =====
  perform pg_temp.sw(o);
  perform public.remove_org_member(org, w1);
  perform pg_temp.sw(w1);
  begin perform public.clock_in(org); msg := msg || 'FAIL a removed worker could clock in' || E'\n';
  exception when others then msg := msg || 'PASS a removed worker cannot clock in' || E'\n'; end;
  select count(*) into n from public.my_orgs();
  msg := msg || pg_temp.ok('a removed worker has no organizations', n = 0);
  perform pg_temp.sw(o);
  select count(*) into n from public.sos_events where user_id = w1;
  msg := msg || pg_temp.ok('after removal the old overseers no longer see that person''s SOS', n = 0);

  perform pg_temp.su();
  raise exception E'RESULT\n%', msg;
end $$;
