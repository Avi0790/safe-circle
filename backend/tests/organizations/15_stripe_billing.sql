-- Stripe billing (migration ...000069): only the service role (the signed
-- webhook) can change a plan from Stripe, each Stripe status maps to the
-- right plan, and the demo buttons stand down once an organization is on
-- Stripe. Rolls itself back; results in the error text.
create function pg_temp.sw(u uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.svc() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
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
  org uuid; code text; r uuid;
  st text; n int; b boolean; txt text; lim int;
  msg text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (o,'o@test.invalid','{"full_name":"A Owner"}'), (ad,'ad@test.invalid','{"full_name":"B Admin"}'),
    (w1,'w1@test.invalid','{"full_name":"E Worker"}');
  perform pg_temp.sw(o);
  select c.org_id, c.invite_code into org, code from public.create_organization('Riverside') c;
  foreach r in array array[ad, w1] loop
    perform pg_temp.sw(r);
    perform public.redeem_org_invite_code(code);
    perform public.accept_org_consent(org);
  end loop;
  perform pg_temp.sw(o);
  perform public.set_org_member_role(org, ad, 'admin');

  -- ===== nobody but the webhook can do this =====
  perform pg_temp.sw(o);
  begin perform public.stripe_sync_subscription(org, 'cus_x', 'sub_x', 'active', 500); msg := msg || 'FAIL the owner marked themselves paid' || E'\n';
  exception when others then msg := msg || 'PASS the owner can''t mark the organization paid' || E'\n'; end;
  begin perform public.org_stripe_customer(org); msg := msg || 'FAIL the owner read the Stripe customer id' || E'\n';
  exception when others then msg := msg || 'PASS Stripe ids aren''t readable from the app' || E'\n'; end;
  select count(*) into n from public.org_billing;
  msg := msg || pg_temp.ok('the billing table can''t be read directly', n = 0);
  select public.org_on_stripe(org) into b;
  msg := msg || pg_temp.ok('not on Stripe yet', b = false);

  -- ===== checkout completes: active, by the seat =====
  perform pg_temp.svc();
  st := public.stripe_sync_subscription(org, 'cus_test1', 'sub_test1', 'active', 7);
  perform pg_temp.sw(o);
  select plan_state, seat_limit into st, lim from public.my_orgs();
  msg := msg || pg_temp.ok('a paid Stripe subscription makes the plan active with its seats', st = 'active' and lim = 7);
  select public.org_on_stripe(org) into b;
  msg := msg || pg_temp.ok('the owner sees it''s on Stripe', b = true);
  perform pg_temp.sw(ad);
  select public.org_on_stripe(org) into b;
  msg := msg || pg_temp.ok('so does an admin', b = true);
  perform pg_temp.sw(w1);
  select public.org_on_stripe(org) into b;
  msg := msg || pg_temp.ok('a worker isn''t told', b is null);
  perform pg_temp.svc();
  select public.org_stripe_customer(org) into txt;
  msg := msg || pg_temp.ok('the webhook can look up the customer for the portal', txt = 'cus_test1');

  -- ===== the demo buttons stand down =====
  perform pg_temp.sw(o);
  txt := null;
  begin perform public.org_demo_billing(org, 'cancel'); exception when others then txt := sqlerrm; end;
  msg := msg || pg_temp.ok('demo billing is refused once on Stripe', txt like 'This organization pays through Stripe%');

  -- ===== later changes from Stripe =====
  perform pg_temp.svc();
  st := public.stripe_sync_subscription(org, null, null, 'active', 12);
  perform pg_temp.sw(o);
  select seat_limit into lim from public.my_orgs();
  msg := msg || pg_temp.ok('changing seats in Stripe changes them here (ids kept)', lim = 12);
  perform pg_temp.svc();
  st := public.stripe_sync_subscription(org, null, null, 'past_due', 12);
  msg := msg || pg_temp.ok('a declined card starts the 7-day grace', st = 'grace');
  perform pg_temp.sw(w1);
  perform public.clock_in(org);
  perform public.clock_out();
  msg := msg || 'PASS workers still clock in during grace' || E'\n';
  perform pg_temp.svc();
  st := public.stripe_sync_subscription(org, null, null, 'incomplete', 12);
  msg := msg || pg_temp.ok('an unfinished checkout changes nothing', st = 'grace');
  st := public.stripe_sync_subscription(org, null, null, 'active', 12);
  msg := msg || pg_temp.ok('paying again restores it', st = 'active');
  st := public.stripe_sync_subscription(org, null, null, 'canceled', 12);
  msg := msg || pg_temp.ok('canceling in Stripe ends the plan', st = 'ended');
  perform pg_temp.sw(w1);
  txt := null;
  begin perform public.clock_in(org); exception when others then txt := sqlerrm; end;
  msg := msg || pg_temp.ok('...and new shifts stop, as with any ended plan', txt like '%plan has ended%');

  -- ===== an unknown organization =====
  perform pg_temp.svc();
  txt := null;
  begin perform public.stripe_sync_subscription(gen_random_uuid(), 'cus_z', 'sub_z', 'active', 1); exception when others then txt := sqlerrm; end;
  msg := msg || pg_temp.ok('a webhook for an organization that doesn''t exist is refused', txt = 'No such organization.');

  perform pg_temp.su();
  raise exception E'RESULT\n%', msg;
end $$;
