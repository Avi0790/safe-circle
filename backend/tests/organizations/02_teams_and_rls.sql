create function pg_temp.sw(u uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

do $$
declare
  o  uuid := '00000000-0000-0000-0000-0000000000a0';
  ad uuid := '00000000-0000-0000-0000-0000000000a1';
  m1 uuid := '00000000-0000-0000-0000-0000000000b1';
  w1 uuid := '00000000-0000-0000-0000-0000000000c1';
  w2 uuid := '00000000-0000-0000-0000-0000000000c2';
  x  uuid := '00000000-0000-0000-0000-0000000000d1';
  org uuid; code text; team uuid; ro uuid;
  n int; n2 int; msg text := ''; txt text;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (o,'o@test.invalid','{"full_name":"Owner"}'), (ad,'ad@test.invalid','{"full_name":"Admin"}'),
    (m1,'m1@test.invalid','{"full_name":"Mgr"}'), (w1,'w1@test.invalid','{"full_name":"W1"}'),
    (w2,'w2@test.invalid','{"full_name":"W2"}'), (x,'x@test.invalid','{"full_name":"Out"}');

  perform pg_temp.sw(o);
  select c.org_id, c.invite_code into org, code from public.create_organization('Crew') c;
  foreach ro in array array[ad, m1, w1, w2] loop
    perform pg_temp.sw(ro);
    perform public.redeem_org_invite_code(code);
    perform public.accept_org_consent(org);
  end loop;

  -- the screen's calls, as the owner
  perform pg_temp.sw(o);
  perform public.set_org_member_role(org, ad, 'admin');
  perform public.set_org_member_role(org, m1, 'manager');
  team := public.create_team(org, 'Crew A');
  perform public.set_team_member(team, m1, false);
  perform public.set_team_member(team, m1, true);          -- "Make lead"
  perform public.set_team_member(team, w1, false);          -- "+ W1"

  -- admin reads exactly what the screen reads, through RLS
  perform pg_temp.sw(ad);
  select count(*) into n from public.teams where org_id = org;
  select count(*) into n2 from public.team_members where team_id = team;
  msg := msg || 'admin reads teams=' || n || ' team_members=' || n2 || E'\n';
  select count(*) into n from public.org_roster(org);
  msg := msg || 'admin roster rows=' || n || E'\n';

  -- manager (lead) and workers read only what they should
  perform pg_temp.sw(m1);
  select count(*) into n from public.teams where org_id = org;
  select count(*) into n2 from public.team_members where team_id = team;
  msg := msg || 'lead manager reads teams=' || n || ' team_members=' || n2 || E'\n';
  perform pg_temp.sw(w1);
  select count(*) into n from public.team_members where team_id = team;
  msg := msg || 'worker in team reads team_members=' || n || ' (own row only expected 1)' || E'\n';
  perform pg_temp.sw(w2);
  select count(*) into n from public.teams where org_id = org;
  select count(*) into n2 from public.team_members where team_id = team;
  msg := msg || 'worker not in team reads teams=' || n || ' team_members=' || n2 || E'\n';
  perform pg_temp.sw(x);
  select count(*) into n from public.teams;
  msg := msg || 'outsider reads teams=' || n || E'\n';

  -- end to end: w1 clocks in, the lead manager now sees w1 and not w2
  perform pg_temp.sw(w1);
  perform public.clock_in(org);
  perform pg_temp.sw(w2);
  perform public.clock_in(org);
  perform pg_temp.sw(m1);
  select count(*), max(full_name) into n, txt from public.org_live_roster(org);
  msg := msg || 'lead manager live roster rows=' || n || ' (' || coalesce(txt,'') || ')' || E'\n';

  -- "Take off team": manager loses sight of w1
  perform pg_temp.sw(ad);
  perform public.remove_team_member(team, w1);
  perform pg_temp.sw(m1);
  select count(*) into n from public.org_live_roster(org);
  msg := msg || 'after taking w1 off team, manager sees=' || n || E'\n';

  -- "Delete team" then re-check
  perform pg_temp.sw(ad);
  perform public.delete_team(team);
  select count(*) into n from public.teams where org_id = org;
  msg := msg || 'teams after delete=' || n || E'\n';

  raise exception E'RESULT\n%', msg;
end $$;
