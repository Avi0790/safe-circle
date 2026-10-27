-- Renaming and deleting an organization (migration ...000067): who may do
-- each, the typed-name check for delete, that deleting removes everything
-- the organization held but nobody's locations, and that everyone else in it
-- is told. Rolls itself back; results in the error text.
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
  x  uuid := '00000000-0000-0000-0000-0000000000d1';
  org uuid; code text; team uuid; r uuid; q bigint;
  n int; txt text; body jsonb;
  msg text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (o,'o@test.invalid','{"full_name":"A Owner"}'), (ad,'ad@test.invalid','{"full_name":"B Admin"}'),
    (m1,'m1@test.invalid','{"full_name":"C Lead"}'), (w1,'w1@test.invalid','{"full_name":"E Worker"}'),
    (x,'x@test.invalid','{"full_name":"X Outsider"}');

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
  team := public.create_team(org, 'A');
  perform public.set_team_member(team, w1, false);
  perform pg_temp.sw(w1);
  perform public.clock_in(org);
  insert into public.locations (user_id, latitude, longitude) values (w1, 35.8, -90.7);

  -- ===== rename =====
  perform pg_temp.sw(ad);
  perform public.rename_organization(org, '  Riverside Crew  ');
  perform pg_temp.sw(w1);
  select name into txt from public.my_orgs() where org_id = org;
  msg := msg || pg_temp.ok('an admin renames it (trimmed), and the worker sees the new name', txt = 'Riverside Crew');
  perform pg_temp.sw(m1);
  begin perform public.rename_organization(org, 'Mine now'); msg := msg || 'FAIL a manager renamed it' || E'\n';
  exception when others then msg := msg || 'PASS a manager can''t rename it' || E'\n'; end;
  perform pg_temp.sw(w1);
  begin perform public.rename_organization(org, 'Mine now'); msg := msg || 'FAIL a worker renamed it' || E'\n';
  exception when others then msg := msg || 'PASS a worker can''t rename it' || E'\n'; end;
  perform pg_temp.sw(x);
  begin perform public.rename_organization(org, 'Mine now'); msg := msg || 'FAIL an outsider renamed it' || E'\n';
  exception when others then msg := msg || 'PASS an outsider can''t rename it' || E'\n'; end;
  perform pg_temp.sw(o);
  begin perform public.rename_organization(org, '   '); msg := msg || 'FAIL an empty name was accepted' || E'\n';
  exception when others then msg := msg || 'PASS an empty name is refused' || E'\n'; end;

  -- ===== delete: who, and the typed name =====
  perform pg_temp.sw(ad);
  begin perform public.delete_organization(org, 'Riverside Crew'); msg := msg || 'FAIL an admin deleted it' || E'\n';
  exception when others then msg := msg || 'PASS an admin can''t delete it' || E'\n'; end;
  perform pg_temp.sw(o);
  txt := null;
  begin perform public.delete_organization(org, 'Riverside'); exception when others then txt := sqlerrm; end;
  msg := msg || pg_temp.ok('the owner must type the current name exactly', txt like 'Type the organization%');
  perform pg_temp.su();
  select count(*) into n from public.organizations where id = org;
  msg := msg || pg_temp.ok('...and nothing was deleted', n = 1);

  -- ===== delete =====
  perform pg_temp.su();
  select coalesce(max(id), 0) into q from net.http_request_queue;
  perform pg_temp.sw(o);
  perform public.delete_organization(org, '  riverside crew ');
  perform pg_temp.su();
  select count(*) into n from public.organizations where id = org;
  msg := msg || pg_temp.ok('the owner deletes it (name match ignores case and spaces)', n = 0);
  select (select count(*) from public.org_members where org_id = org)
       + (select count(*) from public.shifts where org_id = org)
       + (select count(*) from public.teams where org_id = org)
       + (select count(*) from public.org_audit where org_id = org)
       + (select count(*) from public.org_plans where org_id = org)
    into n;
  msg := msg || pg_temp.ok('memberships, shifts, teams, audit log and plan are all gone', n = 0);
  select count(*) into n from public.team_members where team_id = team;
  msg := msg || pg_temp.ok('team memberships are gone', n = 0);
  select count(*) into n from public.locations where user_id = w1;
  msg := msg || pg_temp.ok('the worker''s own locations stay theirs', n = 1);
  select count(*) into n from public.shifts where user_id = w1 and clocked_out_at is null;
  msg := msg || pg_temp.ok('the worker is no longer clocked in anywhere', n = 0);

  perform pg_temp.sw(w1);
  select count(*) into n from public.my_orgs();
  msg := msg || pg_temp.ok('it disappears from the worker''s organizations', n = 0);

  perform pg_temp.su();
  select (case when pg_typeof(r.body)::text = 'bytea' then convert_from(r.body::bytea, 'utf8') else r.body::text end)::jsonb
    into body
  from net.http_request_queue r
  where r.id > q and r.url like '%send-alert-push%'
  order by r.id desc limit 1;
  msg := msg || pg_temp.ok('one push to everyone else in it, not to the owner',
    body is not null
    and jsonb_array_length(body -> 'recipient_ids') = 3
    and (body -> 'recipient_ids') ?& array[ad::text, m1::text, w1::text]
    and not (body -> 'recipient_ids') ? o::text);
  msg := msg || pg_temp.ok('the push names it and says nobody there can see them',
    body ->> 'title' = 'Riverside Crew closed' and body ->> 'body' like '%Nobody there can see you any more%');

  perform pg_temp.su();
  raise exception E'RESULT\n%', msg;
end $$;
