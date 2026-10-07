create function pg_temp.sw(u uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
do $$
declare
  o uuid := '00000000-0000-0000-0000-0000000000a0'; m1 uuid := '00000000-0000-0000-0000-0000000000b1';
  w1 uuid := '00000000-0000-0000-0000-0000000000c1'; x uuid := '00000000-0000-0000-0000-0000000000d1';
  org uuid; code text; team uuid; r uuid; e bigint; a text; b text; c int; d int; emb text;
  t timestamptz := now();
begin
  insert into auth.users (id,email,raw_user_meta_data) values
   (o,'o@test.invalid','{"full_name":"Olive Owner"}'),(m1,'m1@test.invalid','{"full_name":"Max Lead"}'),
   (w1,'w1@test.invalid','{"full_name":"Wendy Worker"}'),(x,'x@test.invalid','{"full_name":"Out Sider"}');
  perform pg_temp.sw(o); select c.org_id,c.invite_code into org,code from public.create_organization('Crew') c;
  foreach r in array array[m1,w1] loop perform pg_temp.sw(r); perform public.redeem_org_invite_code(code); perform public.accept_org_consent(org); end loop;
  perform pg_temp.sw(o); perform public.set_org_member_role(org,m1,'manager'); team := public.create_team(org,'T');
  perform public.set_team_member(team,m1,true); perform public.set_team_member(team,w1,false);
  execute 'reset role';
  insert into public.shifts (org_id,user_id,clocked_in_at) values (org,w1,t - interval '2 hours');
  insert into public.sos_events (user_id,latitude,longitude,created_at) values (w1,1,1,t - interval '20 minutes') returning id into e;
  perform pg_temp.sw(m1); perform public.acknowledge_sos(e);
  perform pg_temp.sw(o);
  select p.full_name into emb from public.sos_events s left join public.profiles p on p.id = s.user_id where s.id = e;
  select max(full_name) filter (where kind='sender'), max(full_name) filter (where kind='ack') into a, b from public.org_sos_details(array[e]);
  perform pg_temp.sw(x);
  select count(*) into c from public.org_sos_details(array[e]);
  perform pg_temp.sw(w1);
  select count(*) into d from public.org_sos_details(array[e]);
  raise exception 'RESULT overseer: profile_embed=% sender=% ack=% | outsider_rows=% | worker_rows=%', coalesce(emb,'NULL'), a, b, c, d;
end $$;
