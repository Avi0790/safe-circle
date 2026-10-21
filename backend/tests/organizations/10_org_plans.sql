-- Paid work organizations (migration ...000064): trial, seats, demo billing,
-- and what an ended plan does and never does. Rolls itself back like the
-- others; results are in the error text.
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
  w1 uuid := '00000000-0000-0000-0000-0000000000c1';
  w2 uuid := '00000000-0000-0000-0000-0000000000c2';
  w3 uuid := '00000000-0000-0000-0000-0000000000c3';
  org uuid; code text; r uuid;
  n int; txt text; st text; lim int; used int; ends timestamptz; grace timestamptz;
  msg text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (o,'o@test.invalid','{"full_name":"A Owner"}'), (ad,'ad@test.invalid','{"full_name":"B Admin"}'),
    (w1,'w1@test.invalid','{"full_name":"E Worker"}'), (w2,'w2@test.invalid','{"full_name":"F Worker"}'),
    (w3,'w3@test.invalid','{"full_name":"G Worker"}');

  perform pg_temp.sw(o);
  select c.org_id, c.invite_code into org, code from public.create_organization('Crew') c;
  foreach r in array array[ad, w1, w2] loop
    perform pg_temp.sw(r);
    perform public.redeem_org_invite_code(code);
    perform public.accept_org_consent(org);
  end loop;
  perform pg_temp.sw(o);
  perform public.set_org_member_role(org, ad, 'admin');

  -- ===== a new organization starts on a trial =====
  select plan_state, seat_limit, seats_used, trial_ends_at into st, lim, used, ends from public.my_orgs();
  msg := msg || pg_temp.ok('new organization: 14-day trial, 10 seats, 2 workers seated',
    st = 'trial' and lim = 10 and used = 2 and ends between now() + interval '13 days' and now() + interval '15 days');
  perform pg_temp.sw(ad);
  select seat_limit into lim from public.my_orgs();
  msg := msg || pg_temp.ok('an admin sees the seats too', lim = 10);
  perform pg_temp.sw(w1);
  select plan_state, seat_limit, trial_ends_at into st, lim, ends from public.my_orgs();
  msg := msg || pg_temp.ok('a worker sees the plan state but not the seats or dates', st = 'trial' and lim is null and ends is null);

  -- ===== nobody can make their organization "paid" by themselves =====
  perform pg_temp.sw(o);
  select count(*) into n from public.org_plans;
  msg := msg || pg_temp.ok('the plan table can''t be read directly', n = 0);
  update public.org_plans set status = 'active', paid_seats = 500 where org_id = org;
  perform pg_temp.su();
  select status into st from public.org_plans where org_id = org;
  msg := msg || pg_temp.ok('a direct update by the owner changes nothing', st = 'trial');
  perform pg_temp.sw(o);
  begin perform public.org_set_plan(org, 'active', 500); msg := msg || 'FAIL the owner called the internal plan setter' || E'\n';
  exception when others then msg := msg || 'PASS the internal plan setter isn''t callable' || E'\n'; end;
  begin perform public.org_plan_state(org); msg := msg || 'FAIL plan lookups are callable' || E'\n';
  exception when others then msg := msg || 'PASS plan lookups aren''t callable' || E'\n'; end;
  perform pg_temp.sw(ad);
  begin perform public.org_demo_billing(org, 'activate', 50); msg := msg || 'FAIL an admin changed the plan' || E'\n';
  exception when others then msg := msg || 'PASS only the owner changes the plan (admin refused)' || E'\n'; end;
  perform pg_temp.sw(w1);
  begin perform public.org_demo_billing(org, 'cancel'); msg := msg || 'FAIL a worker canceled the plan' || E'\n';
  exception when others then msg := msg || 'PASS only the owner changes the plan (worker refused)' || E'\n'; end;

  -- ===== the trial ends while w1 is on shift =====
  perform pg_temp.sw(w1);
  perform public.clock_in(org);
  perform pg_temp.sw(o);
  perform public.org_demo_billing(org, 'end_trial');
  select plan_state, seat_limit into st, lim from public.my_orgs();
  msg := msg || pg_temp.ok('after the trial: plan ended, no seats', st = 'ended' and lim = 0);

  perform pg_temp.sw(w2);
  txt := null;
  begin perform public.clock_in(org); exception when others then txt := sqlerrm; end;
  msg := msg || pg_temp.ok('ended plan: a new shift can''t start, and the message says SOS still works',
    txt like '%plan has ended%' and txt like '%SOS still works%');

  perform pg_temp.sw(w3);
  perform public.redeem_org_invite_code(code);
  txt := null;
  begin perform public.accept_org_consent(org); exception when others then txt := sqlerrm; end;
  msg := msg || pg_temp.ok('ended plan: nobody new can join', txt like 'Crew''s plan has ended%');

  perform pg_temp.sw(w1);
  insert into public.sos_events (latitude, longitude) values (1, 1);
  select count(*) into n from public.sos_events where user_id = w1 and resolved_at is null;
  msg := msg || pg_temp.ok('ended plan: SOS still sends', n = 1);
  perform pg_temp.sw(ad);
  select count(*) into n from public.org_live_roster(org);
  msg := msg || pg_temp.ok('ended plan: the shift already running is still visible to the admin', n = 1);
  perform pg_temp.sw(w1);
  perform public.clock_out();
  select count(*) into n from public.my_orgs() where on_shift;
  msg := msg || pg_temp.ok('ended plan: clocking out still works', n = 0);

  perform pg_temp.su();
  update public.org_members set consent_version = 1 where user_id = w2;
  perform pg_temp.sw(w2);
  txt := null;
  begin perform public.accept_org_consent(org); exception when others then txt := sqlerrm; end;
  msg := msg || pg_temp.ok('ended plan: re-accepting an updated disclosure still works (keeps the seat)', txt is null);

  -- ===== paying, by the seat =====
  perform pg_temp.sw(o);
  begin perform public.org_demo_billing(org, 'activate', 0); msg := msg || 'FAIL zero seats accepted' || E'\n';
  exception when others then msg := msg || 'PASS a plan needs at least one seat' || E'\n'; end;
  perform public.org_demo_billing(org, 'activate', 2);
  select plan_state, seat_limit, seats_used into st, lim, used from public.my_orgs();
  msg := msg || pg_temp.ok('activated with 2 seats, both taken', st = 'active' and lim = 2 and used = 2);

  perform pg_temp.sw(w3);
  txt := null;
  begin perform public.accept_org_consent(org); exception when others then txt := sqlerrm; end;
  msg := msg || pg_temp.ok('full: a third worker is told there are no free seats', txt = 'Crew has no free seats. Ask the owner to add seats.');

  perform pg_temp.sw(o);
  perform public.org_demo_billing(org, 'activate', 3);
  perform pg_temp.sw(w3);
  perform public.accept_org_consent(org);
  perform pg_temp.sw(o);
  select seats_used into used from public.my_orgs();
  msg := msg || pg_temp.ok('a seat added: the third worker joins', used = 3);
  perform pg_temp.sw(w2);
  perform public.clock_in(org);
  perform public.clock_out();
  msg := msg || 'PASS paid plan: workers clock in' || E'\n';

  -- ===== a failed payment: 7 days of grace, then it ends =====
  perform pg_temp.sw(o);
  perform public.org_demo_billing(org, 'payment_failed');
  select plan_state, grace_ends_at into st, grace from public.my_orgs();
  msg := msg || pg_temp.ok('payment failed: grace for 7 days',
    st = 'grace' and grace between now() + interval '6 days' and now() + interval '8 days');
  perform pg_temp.sw(w2);
  perform public.clock_in(org);
  perform public.clock_out();
  msg := msg || 'PASS grace: workers still clock in' || E'\n';
  perform pg_temp.su();
  update public.org_plans set grace_ends_at = now() - interval '1 second' where org_id = org;
  perform pg_temp.sw(w2);
  txt := null;
  begin perform public.clock_in(org); exception when others then txt := sqlerrm; end;
  msg := msg || pg_temp.ok('grace over: new shifts stop', txt like '%plan has ended%');

  perform pg_temp.sw(o);
  perform public.org_demo_billing(org, 'activate', 3);
  select plan_state, grace_ends_at into st, grace from public.my_orgs();
  msg := msg || pg_temp.ok('paying again restores it and clears the grace date', st = 'active' and grace is null);
  perform public.org_demo_billing(org, 'cancel');
  select plan_state into st from public.my_orgs();
  msg := msg || pg_temp.ok('canceling ends the plan', st = 'ended');

  -- ===== another organization's plan is out of reach =====
  perform pg_temp.sw(w1);
  begin perform public.org_demo_billing(org, 'activate', 10); msg := msg || 'FAIL a worker paid for the plan' || E'\n';
  exception when others then msg := msg || 'PASS demo billing refuses non-owners even after cancel' || E'\n'; end;

  perform pg_temp.su();
  raise exception E'RESULT\n%', msg;
end $$;
