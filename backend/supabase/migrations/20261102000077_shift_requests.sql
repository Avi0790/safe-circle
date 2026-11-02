-- Time off and "I can't make this shift". A worker asks; the people who
-- oversee them (owners, admins, the managers who lead them) approve or
-- decline, and the worker is told either way. Approving a shift request
-- takes the worker off that planned shift; approving time off takes them off
-- any planned shift in that time, and schedule_shift() won't plan one there
-- while it stands.

create table public.shift_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('time_off', 'drop')),
  -- time off: the span asked for; a shift request: the planned shift's times
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  scheduled_shift_id uuid references public.scheduled_shifts (id) on delete set null,
  note text check (note is null or char_length(note) <= 200),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'withdrawn')),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index shift_requests_org_idx on public.shift_requests (org_id, status, starts_at);
create index shift_requests_user_idx on public.shift_requests (user_id, created_at desc);
create unique index shift_requests_one_pending_drop on public.shift_requests (scheduled_shift_id)
  where status = 'pending' and kind = 'drop';

alter table public.shift_requests enable row level security;
create policy "shift_requests_select" on public.shift_requests
  for select to authenticated using (public.can_see_schedule(org_id, user_id));
-- Writes go through the functions below.

create function public.request_time_off(p_org uuid, p_from timestamptz, p_to timestamptz, p_note text default null)
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
revoke all on function public.request_time_off(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.request_time_off(uuid, timestamptz, timestamptz, text) to authenticated;

create function public.request_shift_drop(p_shift uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.scheduled_shifts;
  new_id uuid;
  note text := nullif(trim(coalesce(p_note, '')), '');
  who_name text;
begin
  select * into s from public.scheduled_shifts where id = p_shift;
  if s.id is null or s.user_id is distinct from auth.uid() then
    raise exception 'Shift not found.';
  end if;
  if s.starts_at <= now() then
    raise exception 'That shift has already started.';
  end if;
  if note is not null and char_length(note) > 200 then
    raise exception 'Keep the note under 200 characters.';
  end if;
  if exists (select 1 from public.shift_requests where scheduled_shift_id = p_shift and status = 'pending') then
    raise exception 'You''ve already asked about that shift.';
  end if;

  insert into public.shift_requests (org_id, user_id, kind, starts_at, ends_at, scheduled_shift_id, note)
  values (s.org_id, auth.uid(), 'drop', s.starts_at, s.ends_at, s.id, note)
  returning id into new_id;

  select full_name into who_name from public.profiles where id = auth.uid();
  perform public.send_alert_push(
    public.org_overseer_ids(s.org_id, auth.uid()),
    '🔁 ' || coalesce(who_name, 'A worker') || ' can''t make a shift',
    'Open Safe Circle to approve or decline.',
    jsonb_build_object('type', 'shift_request', 'requestId', new_id, 'orgId', s.org_id)
  );
  return new_id;
end;
$$;
revoke all on function public.request_shift_drop(uuid, text) from public, anon;
grant execute on function public.request_shift_drop(uuid, text) to authenticated;

create function public.decide_shift_request(p_id uuid, p_approve boolean)
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
revoke all on function public.decide_shift_request(uuid, boolean) from public, anon;
grant execute on function public.decide_shift_request(uuid, boolean) to authenticated;

create function public.withdraw_shift_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.shift_requests set status = 'withdrawn'
  where id = p_id and user_id = auth.uid() and status = 'pending';
  if not found then
    raise exception 'Request not found.';
  end if;
end;
$$;
revoke all on function public.withdraw_shift_request(uuid) from public, anon;
grant execute on function public.withdraw_shift_request(uuid) to authenticated;

-- Requests for the workers the caller oversees, or their own.
create function public.org_shift_requests(p_org uuid, p_pending_only boolean default false)
returns table (
  id uuid,
  user_id uuid,
  worker_name text,
  kind text,
  starts_at timestamptz,
  ends_at timestamptz,
  note text,
  status text,
  decided_by_name text,
  decided_at timestamptz,
  created_at timestamptz,
  can_decide boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.user_id, p.full_name, r.kind, r.starts_at, r.ends_at, r.note, r.status,
         d.full_name, r.decided_at, r.created_at,
         r.status = 'pending' and (public.is_org_admin(r.org_id) or public.org_can_see_worker(r.org_id, r.user_id))
  from public.shift_requests r
  left join public.profiles p on p.id = r.user_id
  left join public.profiles d on d.id = r.decided_by
  where r.org_id = p_org
    and public.can_see_schedule(r.org_id, r.user_id)
    and (not coalesce(p_pending_only, false) or r.status = 'pending')
    and (r.status = 'pending' or r.created_at > now() - interval '60 days')
  order by (r.status = 'pending') desc, r.starts_at
  limit 200;
$$;
revoke all on function public.org_shift_requests(uuid, boolean) from public, anon;
grant execute on function public.org_shift_requests(uuid, boolean) to authenticated;

-- schedule_shift() as in migration ...000074, now refusing a shift inside
-- approved time off.
create or replace function public.schedule_shift(
  p_org uuid,
  p_user uuid,
  p_starts timestamptz,
  p_ends timestamptz,
  p_note text default null,
  p_job_site uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not (public.is_org_admin(p_org) or public.org_can_see_worker(p_org, p_user)) then
    raise exception 'Only owners, admins and the worker''s managers can plan their shifts.';
  end if;
  if public.org_role_of(p_org, p_user) is distinct from 'worker' then
    raise exception 'Shifts are planned for workers.';
  end if;
  if p_starts is null or p_ends is null or p_ends <= p_starts then
    raise exception 'A shift has to end after it starts.';
  end if;
  if p_ends - p_starts > interval '16 hours' then
    raise exception 'A shift can be at most 16 hours.';
  end if;
  if p_ends < now() then
    raise exception 'That shift is already over.';
  end if;
  if note is not null and char_length(note) > 200 then
    raise exception 'Keep the note under 200 characters.';
  end if;
  if p_job_site is not null and not exists (select 1 from public.job_sites where id = p_job_site and org_id = p_org) then
    raise exception 'That job site isn''t in this organization.';
  end if;
  if exists (
    select 1 from public.scheduled_shifts
    where user_id = p_user and starts_at < p_ends and ends_at > p_starts
  ) then
    raise exception 'They already have a shift then.';
  end if;
  if exists (
    select 1 from public.shift_requests
    where user_id = p_user and org_id = p_org and kind = 'time_off' and status = 'approved'
      and starts_at < p_ends and ends_at > p_starts
  ) then
    raise exception 'They have approved time off then.';
  end if;

  insert into public.scheduled_shifts (org_id, user_id, starts_at, ends_at, job_site_id, note, created_by)
  values (p_org, p_user, p_starts, p_ends, p_job_site, note, auth.uid())
  returning id into new_id;

  perform public.send_alert_push(
    array[p_user],
    '📅 You have a new shift',
    'Open Safe Circle to see when.',
    jsonb_build_object('type', 'schedule', 'scheduledShiftId', new_id, 'orgId', p_org)
  );
  return new_id;
end;
$$;

alter table public.shift_requests replica identity full;
alter publication supabase_realtime add table public.shift_requests;

-- Part of "Download my data" too.
alter function public.export_my_data() rename to export_my_data_through_076;
revoke all on function public.export_my_data_through_076() from public, anon, authenticated;

create function public.export_my_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  return public.export_my_data_through_076() || jsonb_build_object(
    'time_off_and_shift_requests', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'organization', o.name, 'kind', r.kind, 'from', r.starts_at, 'to', r.ends_at,
        'note', r.note, 'status', r.status, 'asked_at', r.created_at, 'answered_at', r.decided_at
      ) order by r.created_at desc), '[]'::jsonb)
      from public.shift_requests r join public.organizations o on o.id = r.org_id
      where r.user_id = auth.uid()
    )
  );
end;
$$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
