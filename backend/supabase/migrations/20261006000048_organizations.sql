-- Organizations: Safe Circle for field crews. A company creates an
-- organization; workers join with a code, read a disclosure and consent,
-- then clock in and out. Managers and admins can see a worker's location
-- ONLY while that worker is clocked in — never off shift — and every look
-- is logged where the worker can read it.
--
-- Deliberately separate from circles. A circle is a peer group where
-- everyone sees everyone; an organization is one-directional (admins and
-- managers see workers, workers never see each other). Stretching
-- circle_members to cover both would blur the privacy rules the circle
-- features rely on.
--
-- Design decision worth knowing: managers get NO read access to `locations`
-- itself. Widening that table's RLS policy would expose a worker's whole
-- history — including personal time before they clocked in — and reads
-- through RLS can't be audited. Instead every manager read goes through the
-- security-definer functions below (org_live_roster, org_worker_track,
-- org_shifts), which enforce the shift window and write org_audit.

-- A forgotten clock-out must not mean being tracked forever: a shift stops
-- being visible after this long, whether or not the cleanup job has run.
create function public.max_shift_length()
returns interval
language sql
immutable
as $$ select interval '14 hours' $$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  type text not null default 'field_crew' check (type in ('field_crew', 'company', 'school')),
  invite_code_hash text not null unique,
  invite_code_expires_at timestamptz not null default now() + interval '48 hours',
  -- Nullable + SET NULL on purpose: ownership lives in org_members, so a
  -- deleted account must not cascade-delete the organization for everyone
  -- else (the same trap circles.created_by has).
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.org_members (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'worker' check (role in ('owner', 'admin', 'manager', 'worker')),
  -- 'invited' = redeemed the code but hasn't read and accepted the
  -- disclosure yet. Nobody can see an invited worker.
  status text not null default 'invited' check (status in ('invited', 'active')),
  consented_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (org_id, user_id),
  check ((status = 'active') = (consented_at is not null))
);

create index org_members_user_idx on public.org_members (user_id);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  created_at timestamptz not null default now()
);

create index teams_org_idx on public.teams (org_id);

create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  is_lead boolean not null default false,
  primary key (team_id, user_id)
);

create index team_members_user_idx on public.team_members (user_id);

create table public.shifts (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  clocked_in_at timestamptz not null default now(),
  clocked_out_at timestamptz,
  check (clocked_out_at is null or clocked_out_at >= clocked_in_at)
);

-- One open shift per person across all organizations, so being clocked in
-- somewhere can't quietly make you visible to a second employer.
create unique index shifts_one_open_per_user on public.shifts (user_id) where clocked_out_at is null;
create index shifts_org_idx on public.shifts (org_id, clocked_in_at desc);
create index shifts_user_idx on public.shifts (user_id, clocked_in_at desc);

create table public.org_audit (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  target_id uuid not null references public.profiles (id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now()
);

create index org_audit_target_idx on public.org_audit (target_id, created_at desc);
create index org_audit_org_idx on public.org_audit (org_id, created_at desc);

alter table public.organizations enable row level security;
alter table public.org_members enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.shifts enable row level security;
alter table public.org_audit enable row level security;

-- ---------------------------------------------------------------------
-- Helpers (security definer so policies don't recurse into each other's RLS)
-- ---------------------------------------------------------------------

create function public.org_role_of(p_org uuid, p_user uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.org_members
  where org_id = p_org and user_id = p_user and status = 'active';
$$;

create function public.is_org_admin(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.org_role_of(p_org) in ('owner', 'admin'), false);
$$;

create function public.team_org(p_team uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.teams where id = p_team;
$$;

create function public.is_team_lead(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team and user_id = auth.uid() and is_lead
  );
$$;

create function public.in_team(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.team_members where team_id = p_team and user_id = auth.uid()
  );
$$;

-- The one visibility rule for people (shift timing is applied by the
-- callers, which is where the per-row time scoping belongs). The target
-- must be an active, consented worker, and the caller must be an
-- owner/admin of the org, or a manager leading a team the worker is on.
create function public.org_can_see_worker(p_org uuid, p_target uuid)
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
    )
    and (
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
      )
    );
$$;

create function public.org_log(p_org uuid, p_actor uuid, p_target uuid, p_action text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.org_audit (org_id, actor_id, target_id, action)
  values (p_org, p_actor, p_target, p_action);
$$;

-- ---------------------------------------------------------------------
-- Read policies. No write policies anywhere: every change goes through the
-- functions below. Workers can only ever read their own rows, so there is
-- no teammate visibility. Managers read via the functions, not these.
-- ---------------------------------------------------------------------

create policy "organizations_select_admin"
  on public.organizations for select
  using (public.is_org_admin(id));

create policy "org_members_select_self_or_admin"
  on public.org_members for select
  using (user_id = auth.uid() or public.is_org_admin(org_id));

create policy "teams_select_admin_or_member"
  on public.teams for select
  using (public.is_org_admin(org_id) or public.in_team(id));

create policy "team_members_select"
  on public.team_members for select
  using (
    user_id = auth.uid()
    or public.is_org_admin(public.team_org(team_id))
    or public.is_team_lead(team_id)
  );

create policy "shifts_select_self_or_admin"
  on public.shifts for select
  using (user_id = auth.uid() or public.is_org_admin(org_id));

-- A worker reads every look at them (and their own membership events); an
-- admin reads the whole organization's log.
create policy "org_audit_select_target_or_admin"
  on public.org_audit for select
  using (target_id = auth.uid() or public.is_org_admin(org_id));

-- ---------------------------------------------------------------------
-- Membership
-- ---------------------------------------------------------------------

create function public.create_organization(p_name text, p_type text default 'field_crew')
returns table (org_id uuid, invite_code text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  new_org uuid;
  plain_code text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  plain_code := public.generate_invite_code();

  insert into public.organizations (name, type, invite_code_hash, created_by)
  values (trim(p_name), p_type, encode(digest(plain_code, 'sha256'), 'hex'), auth.uid())
  returning id into new_org;

  insert into public.org_members (org_id, user_id, role, status, consented_at)
  values (new_org, auth.uid(), 'owner', 'active', now());

  return query select new_org, plain_code;
end;
$$;

create function public.regenerate_org_invite_code(p_org uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  plain_code text;
begin
  if not public.is_org_admin(p_org) then
    raise exception 'Only an owner or admin can do that.';
  end if;

  plain_code := public.generate_invite_code();
  update public.organizations
  set invite_code_hash = encode(digest(plain_code, 'sha256'), 'hex'),
      invite_code_expires_at = now() + interval '48 hours'
  where id = p_org;

  return plain_code;
end;
$$;

-- Same shape as redeem_invite_code (and the same attempt counter, so org
-- codes get the same brute-force protection): null for an invalid or
-- expired code rather than an exception, so a wrong guess still counts.
-- Joining only creates an 'invited' row — no one can see the worker until
-- they accept the disclosure.
create function public.redeem_org_invite_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target_org uuid;
  window_len constant interval := interval '15 minutes';
  max_attempts constant int := 10;
  attempt public.invite_redemption_attempts;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  insert into public.invite_redemption_attempts (user_id, window_start, attempt_count)
  values (auth.uid(), now(), 1)
  on conflict (user_id) do update
    set attempt_count = case
          when invite_redemption_attempts.window_start < now() - window_len then 1
          else invite_redemption_attempts.attempt_count + 1
        end,
        window_start = case
          when invite_redemption_attempts.window_start < now() - window_len then now()
          else invite_redemption_attempts.window_start
        end
  returning * into attempt;

  if attempt.attempt_count > max_attempts then
    raise exception 'Too many invite code attempts. Try again in a few minutes.';
  end if;

  select id into target_org
  from public.organizations
  where invite_code_hash = encode(digest(upper(trim(p_code)), 'sha256'), 'hex')
    and invite_code_expires_at > now();

  if target_org is null then
    return null;
  end if;

  -- Already a member: leave their role and status exactly as they are.
  insert into public.org_members (org_id, user_id, role, status)
  values (target_org, auth.uid(), 'worker', 'invited')
  on conflict do nothing;

  return target_org;
end;
$$;

create function public.accept_org_consent(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.org_members
  set status = 'active', consented_at = now()
  where org_id = p_org and user_id = auth.uid() and status = 'invited';

  if not found then
    raise exception 'There is no pending invitation to accept.';
  end if;

  perform public.org_log(p_org, auth.uid(), auth.uid(), 'joined');
end;
$$;

-- Leaving (or declining) deletes the membership; the cleanup trigger below
-- closes any open shift and drops team rows.
create function public.leave_org(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  my_role text;
begin
  select role into my_role from public.org_members
  where org_id = p_org and user_id = auth.uid();

  if my_role is null then
    return;
  end if;

  if my_role = 'owner' and not exists (
    select 1 from public.org_members
    where org_id = p_org and user_id <> auth.uid() and role = 'owner' and status = 'active'
  ) then
    raise exception 'Make someone else an owner before you leave.';
  end if;

  perform public.org_log(p_org, auth.uid(), auth.uid(), 'left');
  delete from public.org_members where org_id = p_org and user_id = auth.uid();
end;
$$;

create function public.remove_org_member(p_org uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := public.org_role_of(p_org);
  target_role text;
begin
  if caller_role not in ('owner', 'admin') or caller_role is null then
    raise exception 'Only an owner or admin can remove people.';
  end if;
  if p_user = auth.uid() then
    raise exception 'Use leave instead of removing yourself.';
  end if;

  select role into target_role from public.org_members
  where org_id = p_org and user_id = p_user;
  if target_role is null then
    return;
  end if;
  -- Admins can remove managers and workers; only an owner can remove an
  -- admin or another owner.
  if caller_role = 'admin' and target_role in ('owner', 'admin') then
    raise exception 'Only an owner can remove an admin or owner.';
  end if;

  perform public.org_log(p_org, auth.uid(), p_user, 'removed');
  delete from public.org_members where org_id = p_org and user_id = p_user;
end;
$$;

create function public.set_org_member_role(p_org uuid, p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := public.org_role_of(p_org);
  target_role text;
begin
  if caller_role not in ('owner', 'admin') or caller_role is null then
    raise exception 'Only an owner or admin can change roles.';
  end if;
  if p_role not in ('owner', 'admin', 'manager', 'worker') then
    raise exception 'Unknown role.';
  end if;

  target_role := public.org_role_of(p_org, p_user);
  if target_role is null then
    raise exception 'That person is not an active member.';
  end if;

  if caller_role = 'admin' then
    -- Admins manage the field staff; owners and admins are the owner's call.
    if target_role in ('owner', 'admin') or p_role in ('owner', 'admin') then
      raise exception 'Only an owner can change owner or admin roles.';
    end if;
  end if;

  if target_role = 'owner' and p_role <> 'owner' and not exists (
    select 1 from public.org_members
    where org_id = p_org and user_id <> p_user and role = 'owner' and status = 'active'
  ) then
    raise exception 'An organization needs at least one owner.';
  end if;

  update public.org_members set role = p_role where org_id = p_org and user_id = p_user;

  -- Only managers can lead a team.
  if p_role <> 'manager' then
    update public.team_members tm set is_lead = false
    from public.teams t
    where tm.team_id = t.id and t.org_id = p_org and tm.user_id = p_user;
  end if;

  perform public.org_log(p_org, auth.uid(), p_user, 'role_changed:' || p_role);
end;
$$;

-- Runs on every membership delete (leave, remove, account deletion): closes
-- an open shift in that org and drops the person from its teams.
create function public.org_member_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.shifts set clocked_out_at = now()
  where org_id = old.org_id and user_id = old.user_id and clocked_out_at is null;

  delete from public.team_members tm
  using public.teams t
  where tm.team_id = t.id and t.org_id = old.org_id and tm.user_id = old.user_id;

  return old;
end;
$$;

create trigger org_members_cleanup
  before delete on public.org_members
  for each row execute function public.org_member_cleanup();

-- Account deletion must not strand or hand over an organization. If the
-- leaving person was the only owner, an admin (then a manager) inherits it;
-- if only workers remain, the organization is deleted rather than handing
-- someone who can see the whole crew to a worker by accident.
create function public.handle_org_owner_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  successor uuid;
begin
  for r in select org_id from public.org_members where user_id = old.id and role = 'owner' loop
    if not exists (
      select 1 from public.org_members
      where org_id = r.org_id and user_id <> old.id and role = 'owner' and status = 'active'
    ) then
      select user_id into successor
      from public.org_members
      where org_id = r.org_id and user_id <> old.id
        and status = 'active' and role in ('admin', 'manager')
      order by case role when 'admin' then 1 else 2 end, joined_at
      limit 1;

      if successor is null then
        delete from public.organizations where id = r.org_id;
      else
        update public.org_members set role = 'owner'
        where org_id = r.org_id and user_id = successor;
      end if;
    end if;
  end loop;
  return old;
end;
$$;

create trigger profiles_org_owner_deletion
  before delete on public.profiles
  for each row execute function public.handle_org_owner_deletion();

-- ---------------------------------------------------------------------
-- Teams
-- ---------------------------------------------------------------------

create function public.create_team(p_org uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_team uuid;
begin
  if not public.is_org_admin(p_org) then
    raise exception 'Only an owner or admin can create teams.';
  end if;
  insert into public.teams (org_id, name) values (p_org, trim(p_name)) returning id into new_team;
  return new_team;
end;
$$;

create function public.delete_team(p_team uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_org_admin(public.team_org(p_team)) then
    raise exception 'Only an owner or admin can delete teams.';
  end if;
  delete from public.teams where id = p_team;
end;
$$;

create function public.set_team_member(p_team uuid, p_user uuid, p_is_lead boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.team_org(p_team);
  target_role text;
begin
  if org is null or not public.is_org_admin(org) then
    raise exception 'Only an owner or admin can manage teams.';
  end if;

  target_role := public.org_role_of(org, p_user);
  if target_role not in ('worker', 'manager') or target_role is null then
    raise exception 'Only active workers and managers can be on a team.';
  end if;
  if p_is_lead and target_role <> 'manager' then
    raise exception 'Only a manager can lead a team.';
  end if;

  insert into public.team_members (team_id, user_id, is_lead)
  values (p_team, p_user, p_is_lead)
  on conflict (team_id, user_id) do update set is_lead = excluded.is_lead;
end;
$$;

create function public.remove_team_member(p_team uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_org_admin(public.team_org(p_team)) then
    raise exception 'Only an owner or admin can manage teams.';
  end if;
  delete from public.team_members where team_id = p_team and user_id = p_user;
end;
$$;

-- ---------------------------------------------------------------------
-- Clocking in and out
-- ---------------------------------------------------------------------

create function public.clock_in(p_org uuid)
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

  insert into public.shifts (org_id, user_id) values (p_org, auth.uid()) returning id into shift_id;
  return shift_id;
end;
$$;

create function public.clock_out()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.shifts
  set clocked_out_at = least(now(), clocked_in_at + public.max_shift_length())
  where user_id = auth.uid() and clocked_out_at is null;
end;
$$;

create function public.close_stale_shifts()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update public.shifts
  set clocked_out_at = clocked_in_at + public.max_shift_length()
  where clocked_out_at is null and clocked_in_at < now() - public.max_shift_length();
  get diagnostics n = row_count;
  return n;
end;
$$;

select cron.schedule('close-stale-shifts', '*/15 * * * *', 'select public.close_stale_shifts()');

-- ---------------------------------------------------------------------
-- What a person can see about their own memberships
-- ---------------------------------------------------------------------

create function public.my_orgs()
returns table (
  org_id uuid,
  name text,
  type text,
  role text,
  status text,
  consented_at timestamptz,
  on_shift boolean,
  shift_started_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.name, o.type, m.role, m.status, m.consented_at,
         s.id is not null, s.clocked_in_at
  from public.org_members m
  join public.organizations o on o.id = m.org_id
  left join public.shifts s
    on s.org_id = m.org_id and s.user_id = m.user_id
   and s.clocked_out_at is null and s.clocked_in_at > now() - public.max_shift_length()
  where m.user_id = auth.uid()
  order by o.name;
$$;

-- ---------------------------------------------------------------------
-- The manager/admin reads. The only way anyone other than the worker sees a
-- worker's position. Each applies the visibility rule, limits positions to
-- shift windows, and writes the audit log (deduped to once per 15 minutes
-- per viewer and worker, like location_views, so polling isn't noise).
-- ---------------------------------------------------------------------

create function public.org_roster(p_org uuid)
returns table (
  user_id uuid,
  full_name text,
  role text,
  status text,
  consented_at timestamptz,
  on_shift boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.org_role_of(p_org);
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  return query
  select m.user_id, p.full_name, m.role, m.status, m.consented_at,
         exists (
           select 1 from public.shifts s
           where s.user_id = m.user_id and s.org_id = p_org
             and s.clocked_out_at is null and s.clocked_in_at > now() - public.max_shift_length()
         )
  from public.org_members m
  join public.profiles p on p.id = m.user_id
  where m.org_id = p_org
    and (
      m.user_id = auth.uid()
      or v_role in ('owner', 'admin')
      or (v_role = 'manager' and public.org_can_see_worker(p_org, m.user_id))
    )
  order by p.full_name;
end;
$$;

create function public.org_live_roster(p_org uuid)
returns table (
  user_id uuid,
  full_name text,
  latitude double precision,
  longitude double precision,
  speed real,
  battery_level real,
  recorded_at timestamptz,
  clocked_in_at timestamptz,
  team_names text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if coalesce(public.org_role_of(p_org) in ('owner', 'admin', 'manager'), false) is not true then
    return;
  end if;

  return query
  with visible as (
    select s.user_id as uid, s.clocked_in_at as started
    from public.shifts s
    where s.org_id = p_org
      and s.clocked_out_at is null
      and s.clocked_in_at > now() - public.max_shift_length()
      and public.org_can_see_worker(p_org, s.user_id)
  ),
  logged as (
    insert into public.org_audit (org_id, actor_id, target_id, action)
    select p_org, auth.uid(), v.uid, 'viewed_live'
    from visible v
    where not exists (
      select 1 from public.org_audit a
      where a.org_id = p_org and a.actor_id = auth.uid() and a.target_id = v.uid
        and a.action = 'viewed_live' and a.created_at > now() - interval '15 minutes'
    )
    returning 1
  )
  select v.uid, p.full_name, l.latitude, l.longitude, l.speed, l.battery_level,
         l.recorded_at, v.started, tn.names
  from visible v
  join public.profiles p on p.id = v.uid
  left join lateral (
    select x.latitude, x.longitude, x.speed, x.battery_level, x.recorded_at
    from public.locations x
    where x.user_id = v.uid and x.recorded_at >= v.started
    order by x.recorded_at desc
    limit 1
  ) l on true
  left join lateral (
    select string_agg(t.name, ', ' order by t.name) as names
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    where tm.user_id = v.uid and t.org_id = p_org
  ) tn on true
  order by p.full_name;
end;
$$;

create function public.org_shifts(p_org uuid, p_days int default 7, p_limit int default 100)
returns table (
  shift_id bigint,
  user_id uuid,
  full_name text,
  clocked_in_at timestamptz,
  ended_at timestamptz,
  is_open boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if coalesce(public.org_role_of(p_org) in ('owner', 'admin', 'manager'), false) is not true then
    return;
  end if;
  if p_days is null or p_days < 1 or p_days > 90 then p_days := 7; end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then p_limit := 100; end if;

  return query
  select s.id, s.user_id, p.full_name, s.clocked_in_at,
         least(coalesce(s.clocked_out_at, now()), s.clocked_in_at + public.max_shift_length()),
         (s.clocked_out_at is null and s.clocked_in_at > now() - public.max_shift_length())
  from public.shifts s
  join public.profiles p on p.id = s.user_id
  where s.org_id = p_org
    and s.clocked_in_at > now() - make_interval(days => p_days)
    and public.org_can_see_worker(p_org, s.user_id)
  order by s.clocked_in_at desc
  limit p_limit;
end;
$$;

create function public.org_worker_track(
  p_org uuid,
  p_user uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  shift_id bigint,
  latitude double precision,
  longitude double precision,
  speed real,
  battery_level real,
  recorded_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if coalesce(public.org_role_of(p_org) in ('owner', 'admin', 'manager'), false) is not true
     or not public.org_can_see_worker(p_org, p_user) then
    return;
  end if;
  if p_from is null or p_to is null or p_to <= p_from then
    return;
  end if;
  if p_to - p_from > interval '7 days' then
    p_from := p_to - interval '7 days';
  end if;

  if not exists (
    select 1 from public.org_audit a
    where a.org_id = p_org and a.actor_id = auth.uid() and a.target_id = p_user
      and a.action = 'viewed_track' and a.created_at > now() - interval '15 minutes'
  ) then
    insert into public.org_audit (org_id, actor_id, target_id, action)
    values (p_org, auth.uid(), p_user, 'viewed_track');
  end if;

  -- Only pings recorded inside one of this worker's shifts for this org:
  -- personal time before clock-in or after clock-out never comes back.
  return query
  select s.id, l.latitude, l.longitude, l.speed, l.battery_level, l.recorded_at
  from public.shifts s
  join public.locations l
    on l.user_id = s.user_id
   and l.recorded_at >= s.clocked_in_at
   and l.recorded_at <= least(coalesce(s.clocked_out_at, now()), s.clocked_in_at + public.max_shift_length())
  where s.org_id = p_org
    and s.user_id = p_user
    and l.recorded_at between p_from and p_to
  order by l.recorded_at
  limit 5000;
end;
$$;

-- Everything is called through the signed-in client; nothing is open to
-- anon, and the helper writers (org_log) aren't callable at all.
do $$
declare
  f text;
begin
  foreach f in array array[
    'org_role_of(uuid, uuid)', 'is_org_admin(uuid)', 'team_org(uuid)', 'is_team_lead(uuid)',
    'in_team(uuid)', 'org_can_see_worker(uuid, uuid)', 'org_log(uuid, uuid, uuid, text)',
    'create_organization(text, text)', 'regenerate_org_invite_code(uuid)',
    'redeem_org_invite_code(text)', 'accept_org_consent(uuid)', 'leave_org(uuid)',
    'remove_org_member(uuid, uuid)', 'set_org_member_role(uuid, uuid, text)',
    'create_team(uuid, text)', 'delete_team(uuid)', 'set_team_member(uuid, uuid, boolean)',
    'remove_team_member(uuid, uuid)', 'clock_in(uuid)', 'clock_out()', 'close_stale_shifts()',
    'my_orgs()', 'org_roster(uuid)', 'org_live_roster(uuid)', 'org_shifts(uuid, int, int)',
    'org_worker_track(uuid, uuid, timestamptz, timestamptz)',
    'org_member_cleanup()', 'handle_org_owner_deletion()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
  end loop;

  foreach f in array array[
    'org_role_of(uuid, uuid)', 'is_org_admin(uuid)', 'team_org(uuid)', 'is_team_lead(uuid)',
    'in_team(uuid)', 'org_can_see_worker(uuid, uuid)',
    'create_organization(text, text)', 'regenerate_org_invite_code(uuid)',
    'redeem_org_invite_code(text)', 'accept_org_consent(uuid)', 'leave_org(uuid)',
    'remove_org_member(uuid, uuid)', 'set_org_member_role(uuid, uuid, text)',
    'create_team(uuid, text)', 'delete_team(uuid)', 'set_team_member(uuid, uuid, boolean)',
    'remove_team_member(uuid, uuid)', 'clock_in(uuid)', 'clock_out()',
    'my_orgs()', 'org_roster(uuid)', 'org_live_roster(uuid)', 'org_shifts(uuid, int, int)',
    'org_worker_track(uuid, uuid, timestamptz, timestamptz)'
  ] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
