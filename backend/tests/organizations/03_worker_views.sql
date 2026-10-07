create function pg_temp.sw(u uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

do $$
declare
  ad uuid := '00000000-0000-0000-0000-0000000000f1';
  w1 uuid := '00000000-0000-0000-0000-0000000000f2';
  w2 uuid := '00000000-0000-0000-0000-0000000000f3';
  org uuid; code text; n1 int; n2 int; nm text; rl text; nself int;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (ad, 'ad@test.invalid', '{"full_name":"Boss Person"}'),
    (w1, 'w1@test.invalid', '{"full_name":"Worker One"}'),
    (w2, 'w2@test.invalid', '{"full_name":"Worker Two"}');
  perform pg_temp.sw(ad);
  select c.org_id, c.invite_code into org, code from public.create_organization('Crew') c;
  perform pg_temp.sw(w1); perform public.redeem_org_invite_code(code); perform public.accept_org_consent(org);
  perform pg_temp.sw(w2); perform public.redeem_org_invite_code(code); perform public.accept_org_consent(org);
  perform pg_temp.sw(w1); perform public.clock_in(org);
  perform pg_temp.sw(ad);
  perform count(*) from public.org_live_roster(org);
  perform count(*) from public.org_worker_track(org, w1, now() - interval '1 day', now());
  perform pg_temp.sw(w1);
  select count(*), max(viewer_name), max(viewer_role) into n1, nm, rl from public.org_my_views(org);
  perform pg_temp.sw(w2);
  select count(*) into n2 from public.org_my_views(org);
  perform pg_temp.sw(ad);
  select count(*) into nself from public.org_my_views(org);
  raise exception 'RESULT worker_sees=% by=% role=% | other_worker_sees=% | admin_sees_own=%', n1, nm, rl, n2, nself;
end $$;
