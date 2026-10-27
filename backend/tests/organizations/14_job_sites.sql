-- Job sites (migration ...000068): who adds, removes and reads them, the
-- limits, that a worker gets their organizations' sites (not others', not
-- after a plan ends), and that nothing about arrivals is ever stored. Rolls
-- itself back; results in the error text.
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
  ob uuid := '00000000-0000-0000-0000-0000000000e0';
  org uuid; orgb uuid; code text; codeb text; r uuid; site uuid; siteb uuid;
  n int; txt text; i int;
  msg text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (o,'o@test.invalid','{"full_name":"A Owner"}'), (ad,'ad@test.invalid','{"full_name":"B Admin"}'),
    (m1,'m1@test.invalid','{"full_name":"C Lead"}'), (w1,'w1@test.invalid','{"full_name":"E Worker"}'),
    (ob,'ob@test.invalid','{"full_name":"X Other"}');

  perform pg_temp.sw(o);
  select c.org_id, c.invite_code into org, code from public.create_organization('Riverside') c;
  foreach r in array array[ad, m1, w1] loop
    perform pg_temp.sw(r);
    perform public.redeem_org_invite_code(code);
    perform public.accept_org_consent(org);
  end loop;
  perform pg_temp.sw(o);
  perform public.set_org_member_role(org, ad, 'admin');
  perform public.set_org_member_role(org, m1, 'manager');
  perform pg_temp.sw(ob);
  select c.org_id, c.invite_code into orgb, codeb from public.create_organization('Other') c;
  siteb := public.add_job_site(orgb, 'Other yard', 36, -91, 200);

  -- ===== adding =====
  perform pg_temp.sw(o);
  site := public.add_job_site(org, '  Main St yard ', 35.84, -90.70, 150);
  perform pg_temp.sw(ad);
  perform public.add_job_site(org, 'Client office', 35.85, -90.71);
  perform pg_temp.sw(o);
  select count(*) into n from public.org_job_sites(org);
  msg := msg || pg_temp.ok('owner and admin add sites; the name is trimmed',
    n = 2 and exists (select 1 from public.org_job_sites(org) s where s.name = 'Main St yard' and s.radius_m = 150));
  perform pg_temp.sw(m1);
  begin perform public.add_job_site(org, 'Mine', 35, -90); msg := msg || 'FAIL a manager added a site' || E'\n';
  exception when others then msg := msg || 'PASS a manager can''t add sites' || E'\n'; end;
  select count(*) into n from public.org_job_sites(org);
  msg := msg || pg_temp.ok('...but can see them', n = 2);
  perform pg_temp.sw(w1);
  begin perform public.add_job_site(org, 'Mine', 35, -90); msg := msg || 'FAIL a worker added a site' || E'\n';
  exception when others then msg := msg || 'PASS a worker can''t add sites' || E'\n'; end;
  perform pg_temp.sw(o);
  begin perform public.add_job_site(org, 'Huge', 35, -90, 5000); msg := msg || 'FAIL a 5 km radius was accepted' || E'\n';
  exception when others then msg := msg || 'PASS the radius must be 50 to 1000 m' || E'\n'; end;
  begin perform public.add_job_site(org, '  ', 35, -90); msg := msg || 'FAIL an empty name was accepted' || E'\n';
  exception when others then msg := msg || 'PASS a site needs a name' || E'\n'; end;
  begin perform public.add_job_site(orgb, 'Sneaky', 35, -90); msg := msg || 'FAIL an owner added a site to another organization' || E'\n';
  exception when others then msg := msg || 'PASS nobody adds sites to an organization they don''t run' || E'\n'; end;

  -- ===== the 20-site limit =====
  for i in 3..20 loop
    perform public.add_job_site(org, 'Site ' || i, 35 + i / 100.0, -90);
  end loop;
  txt := null;
  begin perform public.add_job_site(org, 'Site 21', 35, -90); exception when others then txt := sqlerrm; end;
  msg := msg || pg_temp.ok('the 21st site is refused (iOS watches 20)', txt like '%up to 20 job sites%');

  -- ===== reading =====
  perform pg_temp.sw(w1);
  select count(*) into n from public.my_job_sites();
  msg := msg || pg_temp.ok('a worker gets their organization''s 20 sites', n = 20);
  select count(*) into n from public.my_job_sites() where org_name = 'Riverside' and name = 'Main St yard';
  msg := msg || pg_temp.ok('...named, with the organization''s name for the reminder', n = 1);
  select count(*) into n from public.my_job_sites() where id = siteb;
  msg := msg || pg_temp.ok('...and not another organization''s', n = 0);
  select count(*) into n from public.org_job_sites(org);
  msg := msg || pg_temp.ok('a worker can''t list sites the admin way', n = 0);
  select count(*) into n from public.job_sites;
  msg := msg || pg_temp.ok('the table can''t be read directly', n = 0);
  perform pg_temp.sw(o);
  select count(*) into n from public.my_job_sites();
  msg := msg || pg_temp.ok('an owner (who never clocks in) gets no reminder sites', n = 0);
  perform pg_temp.sw(ob);
  select count(*) into n from public.org_job_sites(org);
  msg := msg || pg_temp.ok('another organization''s owner can''t list them', n = 0);

  -- ===== an ended plan stops the reminders =====
  perform pg_temp.sw(o);
  perform public.org_demo_billing(org, 'end_trial');
  perform pg_temp.sw(w1);
  select count(*) into n from public.my_job_sites();
  msg := msg || pg_temp.ok('no reminders to clock in when clocking in isn''t possible', n = 0);
  perform pg_temp.sw(o);
  perform public.org_demo_billing(org, 'activate', 5);

  -- ===== removing =====
  perform pg_temp.sw(m1);
  begin perform public.delete_job_site(site); msg := msg || 'FAIL a manager removed a site' || E'\n';
  exception when others then msg := msg || 'PASS a manager can''t remove a site' || E'\n'; end;
  perform pg_temp.sw(ob);
  begin perform public.delete_job_site(site); msg := msg || 'FAIL another owner removed the site' || E'\n';
  exception when others then msg := msg || 'PASS another organization''s owner can''t remove it' || E'\n'; end;
  perform pg_temp.sw(ad);
  perform public.delete_job_site(site);
  perform pg_temp.su();
  select count(*) into n from public.job_sites where id = site;
  msg := msg || pg_temp.ok('an admin removes it', n = 0);

  -- ===== sites go with the organization =====
  perform pg_temp.sw(o);
  perform public.delete_organization(org, 'Riverside');
  perform pg_temp.su();
  select count(*) into n from public.job_sites where org_id = org;
  msg := msg || pg_temp.ok('deleting the organization deletes its sites', n = 0);

  perform pg_temp.su();
  raise exception E'RESULT\n%', msg;
end $$;
