-- Lone-worker check-ins. A worker can ask for check-in reminders when they
-- clock in ("every 30 / 60 / 120 minutes"). If they miss one, the people who
-- oversee them are alerted — as an SOS at their last on-shift location, so it
-- shows up in the same banner, can be acknowledged and resolved, and is
-- re-alerted if nobody responds (migrations ...000030 and ...000051). Tapping
-- "I'm OK" resolves it and starts the next interval.
--
-- Opt-in per shift, and part of the disclosure workers accept (version 2,
-- migration ...000052). The existing "check on me" timer can't serve crews:
-- it is tied to a circle, and a crew member may not be in one.
--
-- A missed check-in is an SOS, and every SOS reaches the sender's circles
-- too — the same as the circle "check on me" timer already does. Workers who
-- want that to stay between them and work can simply not use circles.

alter table public.shifts
  add column checkin_minutes int check (checkin_minutes is null or checkin_minutes between 15 and 240),
  add column next_checkin_due timestamptz,
  add column last_checkin_at timestamptz,
  add column checkin_alerted_at timestamptz,
  add column checkin_sos_id bigint references public.sos_events (id) on delete set null;

-- Replaces clock_in(uuid): adds the optional interval, and refuses to clock
-- in a worker who hasn't accepted the CURRENT disclosure.
drop function public.clock_in(uuid);

create function public.clock_in(p_org uuid, p_checkin_minutes int default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  shift_id bigint;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if public.org_role_of(p_org) is distinct from 'worker' then
    raise exception 'Only workers who have accepted the invitation can clock in.';
  end if;
  if not exists (
    select 1 from public.org_members
    where org_id = p_org and user_id = auth.uid()
      and consent_version >= public.org_disclosure_version()
  ) then
    raise exception 'The disclosure was updated. Review and accept it to clock in.';
  end if;
  if p_checkin_minutes is not null and (p_checkin_minutes < 15 or p_checkin_minutes > 240) then
    raise exception 'Choose a check-in interval between 15 minutes and 4 hours.';
  end if;
  if exists (
    select 1 from public.shifts
    where user_id = auth.uid() and clocked_out_at is null
      and clocked_in_at > now() - public.max_shift_length()
  ) then
    raise exception 'You are already clocked in.';
  end if;

  -- An open shift past the maximum length is stale; close it so the
  -- one-open-shift index doesn't block a fresh clock-in.
  update public.shifts
  set clocked_out_at = least(now(), clocked_in_at + public.max_shift_length())
  where user_id = auth.uid() and clocked_out_at is null;

  insert into public.shifts (org_id, user_id, checkin_minutes, next_checkin_due)
  values (
    p_org, auth.uid(), p_checkin_minutes,
    case when p_checkin_minutes is null then null else now() + make_interval(mins => p_checkin_minutes) end
  )
  returning id into shift_id;
  return shift_id;
end;
$$;

-- "I'm OK": starts the next interval, and if a missed check-in had already
-- raised an alert, resolves it and tells the overseers.
create function public.shift_check_in()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  sh public.shifts;
  due timestamptz;
  who_name text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select * into sh from public.shifts s
  where s.user_id = auth.uid() and s.clocked_out_at is null
    and s.clocked_in_at > now() - public.max_shift_length()
    and s.checkin_minutes is not null
  for update;
  if not found then
    raise exception 'No check-ins are set for this shift.';
  end if;

  due := now() + make_interval(mins => sh.checkin_minutes);
  update public.shifts
  set last_checkin_at = now(), next_checkin_due = due, checkin_alerted_at = null, checkin_sos_id = null
  where id = sh.id;

  if sh.checkin_sos_id is not null then
    update public.sos_events
    set resolved_at = now(), resolved_by = auth.uid()
    where id = sh.checkin_sos_id and resolved_at is null;
  end if;

  if sh.checkin_alerted_at is not null then
    select full_name into who_name from public.profiles where id = auth.uid();
    perform public.send_alert_push(
      public.org_overseer_ids(sh.org_id, auth.uid()),
      '✅ ' || who_name || ' checked in',
      'They''re OK.',
      jsonb_build_object('type', 'checkin', 'shiftId', sh.id)
    );
  end if;

  return due;
end;
$$;

-- Run every minute. A check-in more than 2 minutes overdue on a shift that is
-- still open raises one alert. With no on-shift location to show it falls back
-- to a plain push, so a missed check-in is never silent.
create function public.escalate_missed_checkins()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  loc record;
  has_loc boolean;
  sos_id bigint;
  who_name text;
  n int := 0;
begin
  for s in
    select * from public.shifts
    where clocked_out_at is null
      and clocked_in_at > now() - public.max_shift_length()
      and next_checkin_due is not null
      and next_checkin_due < now() - interval '2 minutes'
      and checkin_alerted_at is null
    for update skip locked
  loop
    select x.latitude, x.longitude into loc
    from public.locations x
    where x.user_id = s.user_id and x.recorded_at >= s.clocked_in_at
    order by x.recorded_at desc
    limit 1;
    has_loc := found;

    sos_id := null;
    if has_loc then
      begin
        insert into public.sos_events (user_id, latitude, longitude, message)
        values (
          s.user_id, loc.latitude, loc.longitude,
          'Automatic alert: missed a scheduled check-in. This is their last known location on shift.'
        )
        returning id into sos_id;
      exception when others then
        -- e.g. the SOS rate limit: they already have alerts out.
        sos_id := null;
      end;
    end if;

    if sos_id is null then
      select full_name into who_name from public.profiles where id = s.user_id;
      perform public.send_alert_push(
        public.org_overseer_ids(s.org_id, s.user_id),
        '⏱️ Missed check-in',
        who_name || ' missed a scheduled check-in' ||
          case when has_loc then '.' else ' and there is no location to show.' end,
        jsonb_build_object('type', 'checkin', 'shiftId', s.id)
      );
    end if;

    update public.shifts set checkin_alerted_at = now(), checkin_sos_id = sos_id where id = s.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

select cron.schedule('missed-checkins', '* * * * *', 'select public.escalate_missed_checkins()');

-- my_orgs gains what the Work tab needs: whether the worker has to re-accept
-- an updated disclosure, and their check-in schedule.
drop function public.my_orgs();

create function public.my_orgs()
returns table (
  org_id uuid,
  name text,
  type text,
  role text,
  status text,
  consented_at timestamptz,
  on_shift boolean,
  shift_started_at timestamptz,
  needs_reconsent boolean,
  checkin_minutes int,
  next_checkin_due timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.name, o.type, m.role, m.status, m.consented_at,
         s.id is not null, s.clocked_in_at,
         (m.role = 'worker' and m.status = 'active' and m.consent_version < public.org_disclosure_version()),
         s.checkin_minutes, s.next_checkin_due
  from public.org_members m
  join public.organizations o on o.id = m.org_id
  left join public.shifts s
    on s.org_id = m.org_id and s.user_id = m.user_id
   and s.clocked_out_at is null and s.clocked_in_at > now() - public.max_shift_length()
  where m.user_id = auth.uid()
  order by o.name;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'clock_in(uuid, int)', 'shift_check_in()', 'escalate_missed_checkins()', 'my_orgs()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
  end loop;
  grant execute on function public.clock_in(uuid, int) to authenticated;
  grant execute on function public.shift_check_in() to authenticated;
  grant execute on function public.my_orgs() to authenticated;
  -- the cron job runs as the database owner; nobody else should be able to
  -- trigger a sweep of everyone's check-ins
  revoke all on function public.escalate_missed_checkins() from authenticated;
end $$;
