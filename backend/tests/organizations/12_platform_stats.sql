-- The platform owner's dashboard (migration ...000066): only a platform admin
-- can read it, nobody can make themselves one, and what it returns is counts
-- only: no names, emails, coordinates or ids. The real database has real data,
-- so the numbers are checked as changes from a baseline. Rolls itself back.
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
  boss uuid := '00000000-0000-0000-0000-0000000000f0';
  o    uuid := '00000000-0000-0000-0000-0000000000a0';
  w1   uuid := '00000000-0000-0000-0000-0000000000c1';
  org uuid; code text; circ uuid;
  before jsonb; after jsonb; txt text; n int; b boolean;
  msg text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (boss,'boss@test.invalid','{"full_name":"Zed Platformowner"}');

  -- ===== nobody is an admin by default, and nobody can make themselves one =====
  perform pg_temp.sw(boss);
  select public.is_platform_admin() into b;
  msg := msg || pg_temp.ok('a new account is not a platform admin', b = false);
  txt := null;
  begin perform public.platform_stats(); exception when others then txt := sqlerrm; end;
  msg := msg || pg_temp.ok('...and is refused the stats', txt = 'Only the platform owner can see this.');
  begin
    insert into public.platform_admins (user_id) values (boss);
    msg := msg || 'FAIL an app user made themselves platform admin' || E'\n';
  exception when others then msg := msg || 'PASS an app user can''t make themselves platform admin' || E'\n'; end;
  select count(*) into n from public.platform_admins;
  msg := msg || pg_temp.ok('the admin list can''t be read from the app', n = 0);

  -- ===== granted by the database owner =====
  perform pg_temp.su();
  insert into public.platform_admins (user_id) values (boss);
  perform pg_temp.sw(boss);
  select public.is_platform_admin() into b;
  msg := msg || pg_temp.ok('once granted, is_platform_admin is true', b = true);
  before := public.platform_stats();
  msg := msg || pg_temp.ok('stats come back with every section',
    before ?& array['accounts', 'circles', 'work', 'safety', 'health', 'seat_price_cents']);
  msg := msg || pg_temp.ok('the seat price is $4', (before ->> 'seat_price_cents')::int = 400);
  msg := msg || pg_temp.ok('14 days of sign-ups, one row per day, ending today',
    jsonb_array_length(before -> 'accounts' -> 'signups_14d') = 14
    and (before -> 'accounts' -> 'signups_14d' -> 13 ->> 'day')::date = current_date);

  -- ===== numbers move with the data =====
  -- created_at as Supabase Auth sets it on a real sign-up
  perform pg_temp.su();
  insert into auth.users (id, email, raw_user_meta_data, created_at) values
    (o,'o@test.invalid','{"full_name":"A Owner"}', now()), (w1,'w1@test.invalid','{"full_name":"E Worker"}', now());
  perform pg_temp.sw(o);
  select c.org_id, c.invite_code into org, code from public.create_organization('Crew') c;
  perform public.org_demo_billing(org, 'activate', 5);
  perform pg_temp.sw(w1);
  perform public.redeem_org_invite_code(code);
  perform public.accept_org_consent(org);
  perform public.clock_in(org);
  insert into public.locations (user_id, latitude, longitude) values (w1, 35.5, -90.5);
  insert into public.sos_events (latitude, longitude) values (35.5, -90.5);

  perform pg_temp.sw(boss);
  after := public.platform_stats();
  msg := msg || pg_temp.ok('two more accounts, both new this week',
    (after #>> '{accounts,total}')::int = (before #>> '{accounts,total}')::int + 2
    and (after #>> '{accounts,new_7d}')::int = (before #>> '{accounts,new_7d}')::int + 2);
  msg := msg || pg_temp.ok('today''s sign-ups count them',
    (after #>> '{accounts,signups_14d,13,count}')::int = (before #>> '{accounts,signups_14d,13,count}')::int + 2);
  msg := msg || pg_temp.ok('one more active today', (after #>> '{accounts,active_24h}')::int = (before #>> '{accounts,active_24h}')::int + 1);
  msg := msg || pg_temp.ok('one more organization, on an active plan',
    (after #>> '{work,organizations}')::int = (before #>> '{work,organizations}')::int + 1
    and (after #>> '{work,active}')::int = (before #>> '{work,active}')::int + 1);
  msg := msg || pg_temp.ok('5 more paid seats, $20 more a month',
    (after #>> '{work,paid_seats}')::int = (before #>> '{work,paid_seats}')::int + 5
    and (after #>> '{work,monthly_revenue_cents}')::int = (before #>> '{work,monthly_revenue_cents}')::int + 2000);
  msg := msg || pg_temp.ok('one more worker, one more on shift',
    (after #>> '{work,workers}')::int = (before #>> '{work,workers}')::int + 1
    and (after #>> '{work,on_shift}')::int = (before #>> '{work,on_shift}')::int + 1);
  msg := msg || pg_temp.ok('one more SOS this week, open, not yet acknowledged',
    (after #>> '{safety,sos_7d}')::int = (before #>> '{safety,sos_7d}')::int + 1
    and (after #>> '{safety,sos_open}')::int = (before #>> '{safety,sos_open}')::int + 1
    and (after #>> '{safety,sos_7d_acknowledged}')::int = (before #>> '{safety,sos_7d_acknowledged}')::int);

  -- a trial organization doesn't add revenue
  perform pg_temp.sw(o);
  perform public.create_organization('Trial Crew');
  perform pg_temp.sw(boss);
  before := after;
  after := public.platform_stats();
  msg := msg || pg_temp.ok('a trial organization counts, but adds no revenue',
    (after #>> '{work,trial}')::int = (before #>> '{work,trial}')::int + 1
    and (after #>> '{work,monthly_revenue_cents}')::int = (before #>> '{work,monthly_revenue_cents}')::int);

  -- ===== nothing personal ever comes back =====
  txt := after::text;
  msg := msg || pg_temp.ok('no names in the stats', txt not like '%Worker%' and txt not like '%Owner%' and txt not like '%Platformowner%');
  msg := msg || pg_temp.ok('no emails in the stats', txt not like '%@%');
  msg := msg || pg_temp.ok('no coordinates in the stats', txt not like '%35.5%' and txt not like '%-90.5%');
  msg := msg || pg_temp.ok('no ids in the stats', txt not like '%' || w1::text || '%' and txt not like '%' || org::text || '%');

  -- ===== a platform admin gets no extra access to people =====
  select count(*) into n from public.locations where user_id = w1;
  msg := msg || pg_temp.ok('being platform admin doesn''t open anyone''s locations', n = 0);
  select count(*) into n from public.org_shifts(org, 7, 100);
  msg := msg || pg_temp.ok('...or another organization''s shifts', n = 0);

  -- ===== other people still can't read it =====
  perform pg_temp.sw(o);
  txt := null;
  begin perform public.platform_stats(); exception when others then txt := sqlerrm; end;
  msg := msg || pg_temp.ok('an organization owner who isn''t platform admin is refused', txt = 'Only the platform owner can see this.');

  perform pg_temp.su();
  raise exception E'RESULT\n%', msg;
end $$;
