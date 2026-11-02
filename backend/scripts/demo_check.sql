-- Before a demo: is the live project ready? Read-only (it ends by raising its
-- report, which rolls back anything it touched), so it's safe to run any time.
-- Usually run through scripts/demo_check.sh, which adds the migration and
-- Edge Function checks; on its own:
--
--   supabase db query --linked -f scripts/demo_check.sql
--
-- Each line is PASS, WARN (works, but worth a look) or FAIL (fix before
-- presenting), with what to do about it.
create function pg_temp.line(status text, label text, fix text default null) returns text language sql as $$
  select status || ' ' || label || case when fix is not null and status <> 'PASS' then '  → ' || fix else '' end || E'\n'
$$;
create function pg_temp.check(ok boolean, label text, fix text) returns text language sql as $$
  select pg_temp.line(case when ok then 'PASS' else 'FAIL' end, label, fix)
$$;
create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
-- rows `who` can read from a table; a refusal counts as none
create function pg_temp.visible(tbl text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from public.%I', tbl) into n;
  return n;
exception when insufficient_privilege then
  return 0;
end $$;

do $$
declare
  msg text := '';
  owner uuid := (select user_id from public.platform_admins order by added_at limit 1);
  org uuid;
  maya uuid;
  workers int;
  sites int;
  plan text;
  seats int;
  on_shift int;
  fresh int;
  j record;
  stale_after interval;
  last_ok timestamptz;
  failed_push int;
  t record;
  leaked text := '';
  n bigint;
begin
  -- ===== the demo data =====
  msg := msg || E'\n— Demo data —\n';
  msg := msg || pg_temp.check(owner is not null, 'a platform owner exists', 'grant one: see migration ...000066');

  select o.id into org from public.organizations o
  where o.name = 'Demo Crew'
    and exists (select 1 from public.org_members m join auth.users u on u.id = m.user_id
                where m.org_id = o.id and u.email like '%@demo.safecircle.invalid')
  limit 1;
  msg := msg || pg_temp.check(org is not null, 'the Demo Crew organization is loaded', 'run scripts/demo_seed.sql');

  if org is not null then
    select count(*) into workers from public.org_members m
    where m.org_id = org and m.role = 'worker' and m.status = 'active' and m.consented_at is not null;
    msg := msg || pg_temp.check(workers = 6, format('6 demo workers, all consented (%s)', workers), 'run scripts/demo_seed.sql again');
    if to_regclass('public.scheduled_shifts') is not null then
      execute 'select count(*) from public.scheduled_shifts where org_id = $1 and starts_at > now()' into n using org;
      msg := msg || pg_temp.check(n >= 10, format('upcoming planned shifts (%s)', n), 'run scripts/demo_seed.sql again');
    end if;

    select count(*) into sites from public.job_sites where org_id = org;
    msg := msg || pg_temp.check(sites = 2, format('2 job sites (%s)', sites), 'run scripts/demo_seed.sql again');

    select p.status, p.paid_seats into plan, seats from public.org_plans p where p.org_id = org;
    msg := msg || pg_temp.check(plan = 'active' and seats = 10, format('a paid 10-seat plan (%s, %s seats)', coalesce(plan, 'none'), coalesce(seats::text, '–')),
      'run scripts/demo_seed.sql again, or set it back in the app''s demo billing');

    select count(*) into on_shift from public.shifts where org_id = org and clocked_out_at is null;
    -- shifts close themselves when a phone goes quiet for long enough, and
    -- the demo "phones" stop reporting once seeded: refresh on the day
    msg := msg || pg_temp.check(on_shift >= 1, format('workers on shift right now (%s)', on_shift),
      'run scripts/demo_seed.sql again: demo shifts end on their own after a few hours');

    select count(distinct s.user_id) into fresh
    from public.shifts s
    join public.locations l on l.user_id = s.user_id and l.recorded_at > now() - interval '30 minutes'
    where s.org_id = org and s.clocked_out_at is null;
    msg := msg || pg_temp.line(case when fresh >= 1 then 'PASS' else 'WARN' end,
      format('the crew map has a recent position (%s on shift seen in the last 30 min)', fresh),
      'run scripts/demo_seed.sql just before presenting, so the map looks live');

    select m.user_id into maya from public.org_members m join auth.users u on u.id = m.user_id
    where m.org_id = org and u.email = 'demo.maya@demo.safecircle.invalid';

    -- the safety history the Safety report and Incidents tabs show
    msg := msg || pg_temp.check(
      exists (select 1 from public.org_members m join auth.users u on u.id = m.user_id
              where m.org_id = org and m.role = 'manager' and u.email = 'demo.grace@demo.safecircle.invalid'),
      'a demo manager (Grace) leads a team', 'run scripts/demo_seed.sql again');
    select count(*) into n from public.shifts where org_id = org and clocked_in_at < now() - interval '42 days';
    msg := msg || pg_temp.check(n > 0, 'eight weeks of shifts for the Safety report', 'run scripts/demo_seed.sql again');
    select count(*) into n from public.sos_events e join public.org_members m on m.user_id = e.user_id and m.org_id = org;
    msg := msg || pg_temp.check(n >= 8, format('past SOS alerts on shift (%s)', n), 'run scripts/demo_seed.sql again');
    msg := msg || pg_temp.check(
      not exists (select 1 from public.sos_events e join public.org_members m on m.user_id = e.user_id and m.org_id = org where e.resolved_at is null),
      'no demo SOS is still active (no red banner)', 'run scripts/demo_reset.sql, then demo_seed.sql');
    select count(*) into n from public.incident_reports where org_id = org;
    msg := msg || pg_temp.check(n >= 6, format('incident reports (%s, %s open)', n,
      (select count(*) from public.incident_reports where org_id = org and status = 'open')), 'run scripts/demo_seed.sql again');
  end if;

  -- ===== the scheduled jobs =====
  msg := msg || E'\n— Scheduled jobs (curfews, SOS escalation, timers...) —\n';
  for j in select jobid, jobname, schedule, active from cron.job order by jobname loop
    -- every-minute and every-few-minutes jobs should have run lately; the
    -- nightly clean-ups within the last day
    stale_after := case when j.schedule like '* %' or j.schedule like '*/%' then interval '20 minutes' else interval '26 hours' end;
    select max(start_time) into last_ok from cron.job_run_details d
    where d.jobid = j.jobid and d.status = 'succeeded';
    msg := msg || pg_temp.check(
      j.active and last_ok > now() - stale_after,
      format('%s (%s) last succeeded %s', j.jobname, j.schedule,
             coalesce(to_char(now() - last_ok, 'HH24"h "MI"m ago"'), 'never')),
      'check cron.job_run_details for its error');
  end loop;
  msg := msg || pg_temp.check((select count(*) from cron.job) >= 11, format('all scheduled jobs present (%s of 11)', (select count(*) from cron.job)),
    'a migration that schedules jobs is missing: supabase db push');

  -- ===== push notifications =====
  msg := msg || E'\n— Push notifications —\n';
  msg := msg || pg_temp.check(exists (select 1 from vault.secrets where name = 'geofence_webhook_secret'),
    'the database can sign its push requests (vault secret)', 'see migration ...000009');
  select count(*) into failed_push from net._http_response
  where created > now() - interval '24 hours' and (status_code is null or status_code >= 400);
  msg := msg || pg_temp.line(case when failed_push = 0 then 'PASS' else 'WARN' end,
    format('push requests in the last 24 h all reached the server (%s failed of %s)', failed_push,
           (select count(*) from net._http_response where created > now() - interval '24 hours')),
    'check net._http_response and the Edge Function logs');

  -- ===== privacy and security =====
  msg := msg || E'\n— Privacy and security —\n';
  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity loop
    leaked := leaked || t.relname || ' ';
  end loop;
  msg := msg || pg_temp.check(leaked = '', 'row level security is on for every table' || case when leaked <> '' then ' (off: ' || trim(leaked) || ')' else '' end,
    'add "enable row level security" in a migration');

  -- someone not signed in sees nothing
  leaked := '';
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '', true);
  foreach t.relname in array array['profiles', 'locations', 'circles', 'circle_members', 'messages', 'sos_events',
                                   'curfews', 'medical_cards', 'organizations', 'org_members', 'shifts', 'job_sites'] loop
    n := pg_temp.visible(t.relname);
    if n > 0 then leaked := leaked || t.relname || ' '; end if;
  end loop;
  execute 'reset role';
  msg := msg || pg_temp.check(leaked = '', 'someone not signed in can''t read anyone''s data' || case when leaked <> '' then ' (readable: ' || trim(leaked) || ')' else '' end,
    'fix that table''s policies');

  -- a worker can't see coworkers' locations or anyone's curfew
  if maya is not null then
    perform pg_temp.as_user(maya);
    select count(*) into n from public.locations where user_id <> maya;
    execute 'reset role';
    msg := msg || pg_temp.check(n = 0, 'a worker can''t see where their coworkers are', 'check the locations policies');
    perform pg_temp.as_user(maya);
    select count(*) into n from public.shifts where user_id <> maya;
    execute 'reset role';
    msg := msg || pg_temp.check(n = 0, 'a worker can''t see their coworkers'' shifts', 'check the shifts policies');
  end if;

  -- the internal jobs can't be run by app users
  msg := msg || pg_temp.check(
    not has_function_privilege('authenticated', 'public.check_curfews()', 'execute')
    and not has_function_privilege('anon', 'public.check_curfews()', 'execute')
    and not has_function_privilege('authenticated', 'public.close_stale_shifts()', 'execute'),
    'app users can''t run the internal scheduled jobs', 'revoke execute (see migration ...000055)');
  msg := msg || pg_temp.check(
    not has_function_privilege('authenticated', 'public.send_alert_push(uuid[], text, text, jsonb)', 'execute'),
    'app users can''t send push notifications directly', 'revoke execute on send_alert_push');

  -- ===== latest features =====
  msg := msg || E'\n— Latest changes —\n';
  msg := msg || pg_temp.check(exists (select 1 from information_schema.columns
                                      where table_schema = 'public' and table_name = 'curfews' and column_name = 'time_zone'),
    'curfews use each person''s time zone (migration ...000070)', 'supabase db push');

  raise exception E'RESULT\n%', msg;
end $$;
