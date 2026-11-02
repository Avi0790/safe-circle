-- Fixes from a security review of migrations ...000074 to ...000077. None let
-- anyone see or change another organization's data; they close gaps in what
-- a member could do inside their own.

-- 1. A roll-call answer carries a position only if the worker is still on
--    shift (they may have clocked out since they were asked).
create or replace function public.answer_roll_call(
  p_id uuid,
  p_answer text,
  p_latitude double precision default null,
  p_longitude double precision default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rc public.org_roll_calls;
  who_name text;
  prior text;
begin
  if p_answer not in ('safe', 'help') then
    raise exception 'Answer safe or help.';
  end if;
  select * into rc from public.org_roll_calls where id = p_id;
  select answer into prior from public.org_roll_call_members where roll_call_id = p_id and user_id = auth.uid();
  if rc.id is null or not found then
    raise exception 'Roll call not found.';
  end if;
  if rc.closed_at is not null then
    raise exception 'That roll call is closed.';
  end if;
  if (p_latitude is null) <> (p_longitude is null)
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'Invalid position.';
  end if;

  -- a position only while still on shift here: off shift, work can't see you
  if not exists (
    select 1 from public.shifts
    where org_id = rc.org_id and user_id = auth.uid() and clocked_out_at is null
      and clocked_in_at > now() - public.max_shift_length()
  ) then
    p_latitude := null;
    p_longitude := null;
  end if;

  -- a later answer replaces an earlier one ("safe" after "help" too)
  update public.org_roll_call_members
  set answer = p_answer, answered_at = now(),
      latitude = coalesce(p_latitude, latitude), longitude = coalesce(p_longitude, longitude)
  where roll_call_id = p_id and user_id = auth.uid();

  if p_answer = 'help' and prior is distinct from 'help' then
    select full_name into who_name from public.profiles where id = auth.uid();
    perform public.send_alert_push(
      array(select distinct unnest(public.org_overseer_ids(rc.org_id, auth.uid()) || array[rc.started_by]) except select auth.uid()),
      '🆘 ' || coalesce(who_name, 'A worker') || ' needs help (roll call)',
      'Open Safe Circle to see where they are.',
      jsonb_build_object('type', 'roll_call_help', 'rollCallId', p_id, 'orgId', rc.org_id, 'userId', auth.uid())
    );
  end if;
end;
$$;

-- 2. At most six roll calls per person per hour: starting and closing them
--    over and over would otherwise push the crew again and again.
create or replace function public.start_roll_call(p_org uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  note text := nullif(trim(coalesce(p_note, '')), '');
  asked uuid[];
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if coalesce(public.org_role_of(p_org) in ('owner', 'admin', 'manager'), false) is not true then
    raise exception 'Only owners, admins and managers can start a roll call.';
  end if;
  if note is not null and char_length(note) > 120 then
    raise exception 'Keep the note under 120 characters.';
  end if;
  if (select count(*) from public.org_roll_calls
      where org_id = p_org and started_by = auth.uid() and created_at > now() - interval '1 hour') >= 6 then
    raise exception 'That''s six roll calls this hour. Wait a little before starting another.';
  end if;
  if exists (
    select 1 from public.org_roll_calls
    where org_id = p_org and started_by = auth.uid() and closed_at is null
  ) then
    raise exception 'You already have a roll call open. Close it first.';
  end if;

  -- everyone on shift here that this person oversees
  select coalesce(array_agg(distinct s.user_id), '{}'::uuid[]) into asked
  from public.shifts s
  where s.org_id = p_org and s.clocked_out_at is null
    and s.clocked_in_at > now() - public.max_shift_length()
    and public.org_can_see_worker(p_org, s.user_id);
  if cardinality(asked) = 0 then
    raise exception 'Nobody you oversee is on shift right now.';
  end if;

  insert into public.org_roll_calls (org_id, started_by, note)
  values (p_org, auth.uid(), note)
  returning id into new_id;
  insert into public.org_roll_call_members (roll_call_id, user_id)
  select new_id, unnest(asked);

  perform public.send_alert_push(
    asked,
    '📣 Roll call: are you safe?',
    'Open Safe Circle and tap "I''m safe" or "I need help".',
    jsonb_build_object('type', 'roll_call', 'rollCallId', new_id, 'orgId', p_org)
  );
  return new_id;
end;
$$;

-- 3. Heat and cold need the temperature, wind the gust speed: the push text
--    is built from them, and a missing one made it empty.
create or replace function public.report_weather_risk(
  p_kind text,
  p_level text,
  p_feels_like_f int default null,
  p_gust_mph int default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.shifts;
  who_name text;
  new_id bigint;
  title text;
  body text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_kind not in ('heat', 'cold', 'storm', 'wind') or p_level not in ('caution', 'danger') then
    raise exception 'Unknown weather risk.';
  end if;
  if p_feels_like_f not between -80 and 160 or p_gust_mph not between 0 and 200
     or (p_kind in ('heat', 'cold') and p_feels_like_f is null)
     or (p_kind = 'wind' and p_gust_mph is null) then
    raise exception 'Implausible weather.';
  end if;

  select * into s from public.shifts
  where user_id = auth.uid() and clocked_out_at is null
    and clocked_in_at > now() - public.max_shift_length();
  if s.id is null then
    return false; -- off shift: nothing to report, and the phone stops checking
  end if;

  insert into public.shift_weather_alerts (org_id, user_id, shift_id, kind, level, feels_like_f, gust_mph)
  values (s.org_id, auth.uid(), s.id, p_kind, p_level, p_feels_like_f, p_gust_mph)
  on conflict (shift_id, kind, level) do nothing
  returning id into new_id;
  if new_id is null then
    return true; -- already told this shift
  end if;

  select full_name into who_name from public.profiles where id = auth.uid();
  who_name := coalesce(who_name, 'A worker');
  if p_kind = 'heat' then
    title := case p_level when 'danger' then '🥵 Dangerous heat where ' || who_name || ' is working'
                          else '🌡️ Heat where ' || who_name || ' is working' end;
    body := 'Feels like ' || p_feels_like_f || '°F. Make sure they get water, shade and rest breaks.';
  elsif p_kind = 'cold' then
    title := case p_level when 'danger' then '🥶 Dangerous cold where ' || who_name || ' is working'
                          else '❄️ Cold where ' || who_name || ' is working' end;
    body := 'Feels like ' || p_feels_like_f || '°F. Make sure they can warm up indoors.';
  elsif p_kind = 'storm' then
    title := '⛈️ Thunderstorm where ' || who_name || ' is working';
    body := 'Lightning risk. They should get indoors or into a vehicle.';
  else
    title := '💨 Strong wind where ' || who_name || ' is working';
    body := 'Gusts of ' || p_gust_mph || ' mph. Work at height or with loose materials should stop.';
  end if;

  perform public.send_alert_push(
    public.org_overseer_ids(s.org_id, auth.uid()),
    title,
    body,
    jsonb_build_object('type', 'shift_weather', 'orgId', s.org_id, 'userId', auth.uid(), 'kind', p_kind, 'level', p_level)
  );
  return true;
end;
$$;

-- 4. At most ten requests waiting at once, so nobody can flood their
--    managers with pushes.
create or replace function public.request_time_off(p_org uuid, p_from timestamptz, p_to timestamptz, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  note text := nullif(trim(coalesce(p_note, '')), '');
  who_name text;
begin
  if public.org_role_of(p_org) is distinct from 'worker' then
    raise exception 'Only workers ask for time off.';
  end if;
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'Time off has to end after it starts.';
  end if;
  if p_to < now() then
    raise exception 'That time has already passed.';
  end if;
  if p_to - p_from > interval '60 days' then
    raise exception 'Ask for at most 60 days at a time.';
  end if;
  if note is not null and char_length(note) > 200 then
    raise exception 'Keep the note under 200 characters.';
  end if;
  if (select count(*) from public.shift_requests
      where org_id = p_org and user_id = auth.uid() and status = 'pending') >= 10 then
    raise exception 'You have 10 requests waiting already. Wait for an answer first.';
  end if;

  insert into public.shift_requests (org_id, user_id, kind, starts_at, ends_at, note)
  values (p_org, auth.uid(), 'time_off', p_from, p_to, note)
  returning id into new_id;

  select full_name into who_name from public.profiles where id = auth.uid();
  perform public.send_alert_push(
    public.org_overseer_ids(p_org, auth.uid()),
    '🏖️ ' || coalesce(who_name, 'A worker') || ' asked for time off',
    'Open Safe Circle to approve or decline.',
    jsonb_build_object('type', 'shift_request', 'requestId', new_id, 'orgId', p_org)
  );
  return new_id;
end;
$$;

-- 5. A shift that has started can't be cancelled: it's the record of what
--    was planned against what happened (late, missed), not something to
--    tidy away afterwards.
create or replace function public.cancel_scheduled_shift(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.scheduled_shifts;
begin
  select * into s from public.scheduled_shifts where id = p_id;
  if s.id is null or not (public.is_org_admin(s.org_id) or public.org_can_see_worker(s.org_id, s.user_id)) then
    raise exception 'Shift not found.';
  end if;
  if s.starts_at <= now() then
    raise exception 'That shift has already started.';
  end if;
  delete from public.scheduled_shifts where id = p_id;
  if s.starts_at > now() then
    perform public.send_alert_push(
      array[s.user_id],
      '📅 A shift was cancelled',
      'Open Safe Circle to see your schedule.',
      jsonb_build_object('type', 'schedule', 'orgId', s.org_id)
    );
  end if;
end;
$$;

-- 6. Nor can a "can't make it" be approved once the shift has started,
--    which would delete it the same way.
create or replace function public.decide_shift_request(p_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.shift_requests;
begin
  select * into r from public.shift_requests where id = p_id;
  if r.id is null or not (public.is_org_admin(r.org_id) or public.org_can_see_worker(r.org_id, r.user_id)) then
    raise exception 'Request not found.';
  end if;
  if r.status <> 'pending' then
    raise exception 'That request has already been answered.';
  end if;
  if p_approve and r.kind = 'drop' and r.starts_at <= now() then
    raise exception 'That shift has already started.';
  end if;

  update public.shift_requests
  set status = case when p_approve then 'approved' else 'declined' end, decided_by = auth.uid(), decided_at = now()
  where id = p_id;

  if p_approve and r.kind = 'drop' and r.scheduled_shift_id is not null then
    delete from public.scheduled_shifts where id = r.scheduled_shift_id;
  elsif p_approve and r.kind = 'time_off' then
    delete from public.scheduled_shifts
    where org_id = r.org_id and user_id = r.user_id and starts_at < r.ends_at and ends_at > r.starts_at and starts_at > now();
  end if;

  perform public.send_alert_push(
    array[r.user_id],
    case
      when r.kind = 'time_off' and p_approve then '✅ Your time off was approved'
      when r.kind = 'time_off' then '❌ Your time off was declined'
      when p_approve then '✅ You''re off that shift'
      else '❌ You''re still on that shift'
    end,
    'Open Safe Circle to see your schedule.',
    jsonb_build_object('type', 'schedule', 'orgId', r.org_id, 'requestId', r.id)
  );
end;
$$;
