-- The safety report for owners, admins and managers: week by week, hours
-- worked, SOS alerts and how fast someone answered, missed check-ins, phones
-- that went quiet on shift, incident reports, and how often anyone looked at
-- a worker's location. Built from what's already recorded, with the same
-- scope as everything else at work: owners and admins see the whole
-- organization, a manager sees the workers on teams they lead.
--
-- Missed check-ins and quiet phones were only ever flags on the open shift
-- (cleared again once the worker answers), so they leave no history. A small
-- log records each one as it's raised, by triggers on those flags, without
-- touching the scheduled jobs that raise them.

create table public.org_safety_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('missed_checkin', 'quiet_phone')),
  shift_id bigint references public.shifts (id) on delete set null,
  created_at timestamptz not null default now()
);
create index org_safety_events_org_idx on public.org_safety_events (org_id, created_at);

-- Read only through org_safety_report(); nobody reads or writes it directly.
alter table public.org_safety_events enable row level security;

create function public.log_safety_flags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.checkin_alerted_at is not null and new.checkin_alerted_at is distinct from old.checkin_alerted_at then
    insert into public.org_safety_events (org_id, user_id, kind, shift_id)
    values (new.org_id, new.user_id, 'missed_checkin', new.id);
  end if;
  if new.quiet_alerted_at is not null and old.quiet_alerted_at is null then
    insert into public.org_safety_events (org_id, user_id, kind, shift_id)
    values (new.org_id, new.user_id, 'quiet_phone', new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.log_safety_flags() from public, anon, authenticated;

create trigger shifts_log_safety_flags
  after update of checkin_alerted_at, quiet_alerted_at on public.shifts
  for each row execute function public.log_safety_flags();

create function public.org_safety_report(p_org uuid, p_weeks int default 8, p_tz text default 'UTC')
returns table (
  week_start date,
  hours numeric,
  shifts bigint,
  workers bigint,
  sos bigint,
  sos_answered bigint,
  median_response_minutes numeric,
  missed_checkins bigint,
  quiet_phones bigint,
  incidents bigint,
  incidents_resolved bigint,
  location_views bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tz text := coalesce(nullif(trim(p_tz), ''), 'UTC');
  weeks int := least(greatest(coalesce(p_weeks, 8), 1), 26);
  admin boolean;
  this_week date;
  first_week date;
  since timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  admin := public.is_org_admin(p_org);
  if not admin and public.org_role_of(p_org) is distinct from 'manager' then
    raise exception 'Only owners, admins and managers can see the safety report.';
  end if;
  if not exists (select 1 from pg_timezone_names where name = tz) then
    tz := 'UTC';
  end if;

  this_week := date_trunc('week', now() at time zone tz)::date;
  first_week := this_week - (weeks - 1) * 7;
  since := first_week::timestamp at time zone tz;

  return query
  with
  wk as (
    select generate_series(first_week, this_week, interval '7 days')::date as ws
  ),
  -- the people this caller may see: everyone for owners and admins (former
  -- workers' history included), the workers on their teams for a manager
  sh as (
    select s.id, s.user_id, s.clocked_in_at, s.clocked_out_at,
           date_trunc('week', s.clocked_in_at at time zone tz)::date as ws,
           extract(epoch from least(coalesce(s.clocked_out_at, now()), s.clocked_in_at + interval '14 hours') - s.clocked_in_at) / 3600.0 as h
    from public.shifts s
    where s.org_id = p_org and s.clocked_in_at >= since
      and (admin or public.org_can_see_worker(p_org, s.user_id))
  ),
  sos_ev as (
    select distinct e.id,
           date_trunc('week', e.created_at at time zone tz)::date as ws,
           (select min(a.created_at) from public.sos_acknowledgements a where a.sos_event_id = e.id) - e.created_at as wait
    from public.sos_events e
    join public.shifts s
      on s.user_id = e.user_id and s.org_id = p_org
     and e.created_at >= s.clocked_in_at and e.created_at <= coalesce(s.clocked_out_at, now())
    where e.created_at >= since
      and (admin or public.org_can_see_worker(p_org, e.user_id))
  ),
  flags as (
    select f.kind, date_trunc('week', f.created_at at time zone tz)::date as ws
    from public.org_safety_events f
    where f.org_id = p_org and f.created_at >= since
      and (admin or public.org_can_see_worker(p_org, f.user_id))
  ),
  inc as (
    select r.status, date_trunc('week', r.created_at at time zone tz)::date as ws
    from public.incident_reports r
    where r.org_id = p_org and r.created_at >= since
      and public.can_see_incident(r.org_id, r.user_id)
  ),
  looks as (
    select date_trunc('week', a.created_at at time zone tz)::date as ws
    from public.org_audit a
    where a.org_id = p_org and a.created_at >= since
      and a.action in ('viewed_live', 'viewed_track')
      and (admin or public.org_can_see_worker(p_org, a.target_id))
  )
  select
    wk.ws,
    coalesce(round((select sum(sh.h) from sh where sh.ws = wk.ws)::numeric, 1), 0),
    (select count(*) from sh where sh.ws = wk.ws),
    (select count(distinct sh.user_id) from sh where sh.ws = wk.ws),
    (select count(*) from sos_ev where sos_ev.ws = wk.ws),
    (select count(*) from sos_ev where sos_ev.ws = wk.ws and sos_ev.wait is not null),
    (select round((percentile_cont(0.5) within group (order by extract(epoch from sos_ev.wait) / 60.0))::numeric, 1)
       from sos_ev where sos_ev.ws = wk.ws and sos_ev.wait is not null),
    (select count(*) from flags where flags.ws = wk.ws and flags.kind = 'missed_checkin'),
    (select count(*) from flags where flags.ws = wk.ws and flags.kind = 'quiet_phone'),
    (select count(*) from inc where inc.ws = wk.ws),
    (select count(*) from inc where inc.ws = wk.ws and inc.status = 'resolved'),
    (select count(*) from looks where looks.ws = wk.ws)
  from wk
  order by wk.ws;
end;
$$;
revoke all on function public.org_safety_report(uuid, int, text) from public, anon;
grant execute on function public.org_safety_report(uuid, int, text) to authenticated;
