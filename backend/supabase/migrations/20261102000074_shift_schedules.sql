-- Shift schedules: owners, admins and a worker's managers plan shifts ahead;
-- the worker sees their own and their phone reminds them before each one
-- (mobile/lib/shiftReminders.ts). Planned shifts are then compared with the
-- real clock-ins: upcoming, on time, late, missed or worked.
--
-- Same scope as the rest of work mode: a worker sees only their own planned
-- shifts; owners and admins see everyone's; a manager sees and plans the
-- workers on teams they lead. A schedule is times only, never a location.

-- org_can_see_worker answered null, not false, when the caller has no role in
-- the organization, so a check written "if not (admin or can see) then refuse"
-- let an outsider through (resolve_incident, for one). Same rule as migration
-- ...000052, now always true or false.
create or replace function public.org_can_see_worker(p_org uuid, p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.org_members w
      where w.org_id = p_org and w.user_id = p_target
        and w.role = 'worker' and w.status = 'active' and w.consented_at is not null
        and w.consent_version >= public.org_disclosure_version()
    )
    and coalesce(
      public.org_role_of(p_org) in ('owner', 'admin')
      or (
        public.org_role_of(p_org) = 'manager'
        and exists (
          select 1
          from public.team_members lead
          join public.teams t on t.id = lead.team_id
          join public.team_members tm on tm.team_id = lead.team_id
          where t.org_id = p_org
            and lead.user_id = auth.uid() and lead.is_lead
            and tm.user_id = p_target
        )
      ),
      false
    );
$$;

create table public.scheduled_shifts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  job_site_id uuid references public.job_sites (id) on delete set null,
  note text check (note is null or char_length(note) <= 200),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '16 hours')
);
create index scheduled_shifts_org_idx on public.scheduled_shifts (org_id, starts_at);
create index scheduled_shifts_user_idx on public.scheduled_shifts (user_id, starts_at);

alter table public.scheduled_shifts enable row level security;

-- org_can_see_worker isn't callable by clients (migration ...000055), so the
-- policy goes through this, as incident reports do.
create function public.can_see_schedule(p_org uuid, p_worker uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_worker = auth.uid()
    or public.is_org_admin(p_org)
    or public.org_can_see_worker(p_org, p_worker);
$$;
revoke all on function public.can_see_schedule(uuid, uuid) from public, anon;
grant execute on function public.can_see_schedule(uuid, uuid) to authenticated;

create policy "scheduled_shifts_select"
  on public.scheduled_shifts for select to authenticated
  using (public.can_see_schedule(org_id, user_id));
-- Writes go through schedule_shift() and cancel_scheduled_shift().

create function public.schedule_shift(
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
revoke all on function public.schedule_shift(uuid, uuid, timestamptz, timestamptz, text, uuid) from public, anon;
grant execute on function public.schedule_shift(uuid, uuid, timestamptz, timestamptz, text, uuid) to authenticated;

create function public.cancel_scheduled_shift(p_id uuid)
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
revoke all on function public.cancel_scheduled_shift(uuid) from public, anon;
grant execute on function public.cancel_scheduled_shift(uuid) to authenticated;

-- Planned against actual, for whoever may see these workers: each planned
-- shift with the clock-in nearest its start (within 3 hours), and what that
-- makes it. Late = clocked in more than 10 minutes after the start; missed =
-- no clock-in by an hour after the start.
create function public.org_schedule(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table (
  id uuid,
  user_id uuid,
  worker_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  job_site text,
  note text,
  clocked_in_at timestamptz,
  clocked_out_at timestamptz,
  status text
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.user_id, p.full_name, s.starts_at, s.ends_at, js.name, s.note,
         w.clocked_in_at, w.clocked_out_at,
         case
           when w.clocked_in_at is not null and w.clocked_in_at > s.starts_at + interval '10 minutes' then 'late'
           when w.clocked_in_at is not null and coalesce(w.clocked_out_at, now()) >= s.ends_at then 'worked'
           when w.clocked_in_at is not null then 'on_time'
           when now() > s.starts_at + interval '1 hour' then 'missed'
           else 'upcoming'
         end
  from public.scheduled_shifts s
  left join public.profiles p on p.id = s.user_id
  left join public.job_sites js on js.id = s.job_site_id
  left join lateral (
    select sh.clocked_in_at, sh.clocked_out_at
    from public.shifts sh
    where sh.org_id = s.org_id and sh.user_id = s.user_id
      and sh.clocked_in_at between s.starts_at - interval '3 hours' and s.starts_at + interval '3 hours'
    order by abs(extract(epoch from sh.clocked_in_at - s.starts_at))
    limit 1
  ) w on true
  where s.org_id = p_org
    and s.starts_at < p_to and s.ends_at > p_from
    and public.can_see_schedule(s.org_id, s.user_id)
  order by s.starts_at;
$$;
revoke all on function public.org_schedule(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.org_schedule(uuid, timestamptz, timestamptz) to authenticated;

-- whole rows on delete, so a worker's phone hears of a cancelled shift
alter table public.scheduled_shifts replica identity full;
alter publication supabase_realtime add table public.scheduled_shifts;
