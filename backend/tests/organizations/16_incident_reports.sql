-- Incident and hazard reports (migration ...000072). Rolls itself back;
-- results in the error text.
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
create function pg_temp.err(sql text) returns text language plpgsql as $$
begin execute sql; return null; exception when others then return sqlerrm; end $$;

do $$
declare
  o  uuid := '00000000-0000-0000-0000-0000000000a0';  -- owner
  m1 uuid := '00000000-0000-0000-0000-0000000000b1';  -- leads w1's team
  m2 uuid := '00000000-0000-0000-0000-0000000000b2';  -- manager of another team
  w1 uuid := '00000000-0000-0000-0000-0000000000c1';
  w2 uuid := '00000000-0000-0000-0000-0000000000c2';
  x  uuid := '00000000-0000-0000-0000-0000000000d1';  -- outsider
  org uuid; code text; ta uuid; tb uuid; r uuid; rep uuid; rep2 uuid; rep3 uuid;
  n int; txt text; aud uuid[]; lat double precision; st text; ex jsonb; b boolean;
  msg text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (o, 'o@test.invalid', '{"full_name":"Olive Owner"}'), (m1, 'm1@test.invalid', '{"full_name":"Max Lead"}'),
    (m2, 'm2@test.invalid', '{"full_name":"Mia Other"}'), (w1, 'w1@test.invalid', '{"full_name":"Wendy Worker"}'),
    (w2, 'w2@test.invalid', '{"full_name":"Walt Worker"}'), (x, 'x@test.invalid', '{"full_name":"Out Sider"}');
  perform pg_temp.sw(o);
  select c.org_id, c.invite_code into org, code from public.create_organization('Crew') c;
  foreach r in array array[m1, m2, w1, w2] loop
    perform pg_temp.sw(r); perform public.redeem_org_invite_code(code); perform public.accept_org_consent(org);
  end loop;
  perform pg_temp.sw(o);
  perform public.set_org_member_role(org, m1, 'manager');
  perform public.set_org_member_role(org, m2, 'manager');
  ta := public.create_team(org, 'A'); tb := public.create_team(org, 'B');
  perform public.set_team_member(ta, m1, true); perform public.set_team_member(ta, w1, false);
  perform public.set_team_member(tb, m2, true); perform public.set_team_member(tb, w2, false);

  -- ===== reporting =====
  perform pg_temp.sw(w1);
  perform public.clock_in(org);
  rep := public.report_incident(org, 'hazard', '  Loose scaffolding on level 3  ', 35.84, -90.70, org::text || '/' || w1::text || '/a.jpg');
  perform pg_temp.su();
  select latitude, note into lat, txt from public.incident_reports where id = rep;
  msg := msg || pg_temp.ok('a worker on shift files a report, with their position', lat = 35.84 and txt = 'Loose scaffolding on level 3');
  aud := public.incident_audience(org, w1);
  msg := msg || pg_temp.ok('it goes to the owner and the manager who leads them, not the other manager',
    o = any(aud) and m1 = any(aud) and not (m2 = any(aud)) and cardinality(aud) = 2);

  perform pg_temp.sw(w2);
  rep2 := public.report_incident(org, 'near_miss', 'Forklift nearly backed into me', 35.80, -90.60);
  perform pg_temp.su();
  select latitude into lat from public.incident_reports where id = rep2;
  msg := msg || pg_temp.ok('off shift, the position is never stored', lat is null);

  perform pg_temp.sw(m1);
  rep3 := public.report_incident(org, 'other', 'Gate code changed');
  perform pg_temp.su();
  aud := public.incident_audience(org, m1);
  msg := msg || pg_temp.ok('a manager''s own report goes to owners and admins', aud = array[o]);

  perform pg_temp.sw(x);
  txt := pg_temp.err(format('select public.report_incident(%L, ''hazard'', ''x'')', org));
  msg := msg || pg_temp.ok('someone outside the organization can''t report', txt like '%not in this organization%');
  perform pg_temp.sw(w2);
  txt := pg_temp.err(format('select public.report_incident(%L, ''fire'', ''x'')', org));
  msg := msg || pg_temp.ok('an unknown kind is refused', txt like 'Choose hazard%');
  txt := pg_temp.err(format('select public.report_incident(%L, ''hazard'', ''   '')', org));
  msg := msg || pg_temp.ok('an empty note is refused', txt = 'Say what happened.');
  txt := pg_temp.err(format('select public.report_incident(%L, ''hazard'', ''x'', null, null, %L)', org, org::text || '/' || w1::text || '/a.jpg'));
  msg := msg || pg_temp.ok('someone else''s photo can''t be attached', txt like '%isn''t yours%');
  txt := pg_temp.err(format('insert into public.incident_reports (org_id, user_id, kind, note) values (%L, %L, ''hazard'', ''x'')', org, w2));
  msg := msg || pg_temp.ok('reports can''t be written directly, only through report_incident', txt is not null);

  -- ===== who can read =====
  perform pg_temp.sw(w1); select count(*) into n from public.incident_reports;
  msg := msg || pg_temp.ok('a worker sees only their own report', n = 1);
  perform pg_temp.sw(o); select count(*) into n from public.incident_reports where org_id = org;
  msg := msg || pg_temp.ok('the owner sees all three', n = 3);
  perform pg_temp.sw(m1); select count(*) into n from public.incident_reports where id in (rep, rep2, rep3);
  msg := msg || pg_temp.ok('a manager sees their team''s report and their own, not another team''s', n = 2);
  perform pg_temp.sw(m2); select count(*) into n from public.incident_reports where id in (rep, rep3);
  msg := msg || pg_temp.ok('the other manager sees neither', n = 0);
  perform pg_temp.sw(x); select count(*) into n from public.incident_reports;
  msg := msg || pg_temp.ok('an outsider sees nothing', n = 0);

  -- the list the apps show, with names only for people you may see
  perform pg_temp.sw(m1);
  select count(*) into n from public.org_incidents(org);
  select reporter_name, can_resolve into txt, b from public.org_incidents(org) where id = rep;
  perform pg_temp.su();
  msg := msg || pg_temp.ok('the manager''s list names the worker and lets them resolve it', n = 2 and txt = 'Wendy Worker' and b);
  perform pg_temp.sw(w1);
  select count(*), bool_or(can_resolve) into n, b from public.org_incidents(org);
  perform pg_temp.su();
  msg := msg || pg_temp.ok('a worker''s list is just their own, with no resolve button', n = 1 and not b);
  perform pg_temp.sw(o);
  select count(*) into n from public.org_incidents(org, 'open');
  perform pg_temp.su();
  msg := msg || pg_temp.ok('the owner can list only open reports', n = 3);

  -- ===== resolving =====
  perform pg_temp.sw(w1);
  txt := pg_temp.err(format('select public.resolve_incident(%L)', rep));
  msg := msg || pg_temp.ok('a worker can''t resolve their own report', txt like 'Only owners%');
  perform pg_temp.sw(m2);
  txt := pg_temp.err(format('select public.resolve_incident(%L)', rep));
  msg := msg || pg_temp.ok('another team''s manager can''t either', txt = 'Report not found.');
  perform pg_temp.sw(m1);
  perform public.resolve_incident(rep);
  perform pg_temp.su();
  select status into st from public.incident_reports where id = rep;
  msg := msg || pg_temp.ok('the worker''s manager resolves it', st = 'resolved');

  -- ===== photos =====
  insert into storage.objects (bucket_id, name, owner)
  values ('incident-photos', org::text || '/' || w1::text || '/a.jpg', w1);
  perform pg_temp.sw(m1); select count(*) into n from storage.objects where bucket_id = 'incident-photos';
  msg := msg || pg_temp.ok('the manager can open the report''s photo', n = 1);
  perform pg_temp.sw(w2); select count(*) into n from storage.objects where bucket_id = 'incident-photos';
  msg := msg || pg_temp.ok('a coworker can''t', n = 0);
  perform pg_temp.sw(x);
  txt := pg_temp.err(format('insert into storage.objects (bucket_id, name, owner) values (''incident-photos'', %L, %L)', org::text || '/' || x::text || '/b.jpg', x));
  msg := msg || pg_temp.ok('an outsider can''t upload into the organization''s folder', txt is not null);

  -- ===== your data =====
  perform pg_temp.sw(w2);
  ex := public.export_my_data();
  msg := msg || pg_temp.ok('"Download my data" includes your reports', jsonb_array_length(ex -> 'incident_reports') = 1);

  perform pg_temp.su();
  raise exception E'RESULT\n%', msg;
end $$;
