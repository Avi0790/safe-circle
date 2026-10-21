-- Paid work organizations (demo billing). Family circles stay free and are
-- not touched here; only organizations have a plan.
--
--   trial   14 days from creation, up to 10 workers
--   active  paid, up to the seats bought
--   grace   a payment failed: works as before for 7 days
--   ended   trial over, grace over, or canceled
--
-- What an ended plan stops: new workers joining, and workers starting a new
-- shift. What it never stops: SOS, clocking out, a shift already running
-- (and its check-in and quiet-phone alerts), anyone's family circles, and
-- leaving or exporting. Money must never decide whether someone is safe.
--
-- The plan lives in its own table with no write policies, so an owner can't
-- mark their own organization paid with a direct update. It changes only
-- through org_set_plan(), which is internal: for the demo the owner calls
-- org_demo_billing() below; a real payment provider's webhook (running with
-- the service role) would call org_set_plan() instead.

create table public.org_plans (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  status text not null default 'trial' check (status in ('trial', 'active', 'past_due', 'canceled')),
  trial_ends_at timestamptz not null default now() + interval '14 days',
  paid_seats int check (paid_seats between 1 and 500),
  grace_ends_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.org_plans enable row level security;
-- No policies: nobody reads or writes this table directly. my_orgs() reports
-- the plan to the people who run the organization.

create function public.trial_seats() returns int
language sql immutable as $$ select 10 $$;

-- Every organization gets a trial when it's created; existing ones start
-- theirs now.
create function public.org_plan_on_create()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.org_plans (org_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger organizations_plan
  after insert on public.organizations
  for each row execute function public.org_plan_on_create();

insert into public.org_plans (org_id)
select id from public.organizations
on conflict do nothing;

-- 'trial' | 'active' | 'grace' | 'ended'
create function public.org_plan_state(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.status = 'active' then 'active'
    when p.status = 'past_due' and p.grace_ends_at > now() then 'grace'
    when p.status = 'trial' and p.trial_ends_at > now() then 'trial'
    else 'ended'
  end
  from public.org_plans p
  where p.org_id = p_org;
$$;

create function public.org_seat_limit(p_org uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case public.org_plan_state(p_org)
    when 'trial' then public.trial_seats()
    when 'ended' then 0
    else coalesce(p.paid_seats, 0)
  end
  from public.org_plans p
  where p.org_id = p_org;
$$;

-- Seats are workers (the people who clock in) who have joined. Owners,
-- admins and managers are free.
create function public.org_seats_used(p_org uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.org_members
  where org_id = p_org and role = 'worker' and status = 'active';
$$;

-- The one place a plan changes. Internal: revoked from app users below.
create function public.org_set_plan(p_org uuid, p_status text, p_seats int default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('trial', 'active', 'past_due', 'canceled') then
    raise exception 'Unknown plan status %', p_status;
  end if;
  if p_status = 'active' and (p_seats is null or p_seats < 1 or p_seats > 500) then
    raise exception 'Choose between 1 and 500 seats.';
  end if;

  update public.org_plans
  set status = p_status,
      paid_seats = case when p_status = 'active' then p_seats else paid_seats end,
      grace_ends_at = case
        when p_status = 'past_due' then coalesce(grace_ends_at, now() + interval '7 days')
        else null
      end,
      updated_at = now()
  where org_id = p_org;

  if not found then
    raise exception 'No such organization.';
  end if;
end;
$$;

-- Demo billing, owner only, no money involved:
--   activate        pay for p_seats seats
--   payment_failed  a card was declined: 7 days of grace
--   cancel          stop paying
--   end_trial       skip to the end of the trial, to show what happens
create function public.org_demo_billing(p_org uuid, p_action text, p_seats int default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if public.org_role_of(p_org) is distinct from 'owner' then
    raise exception 'Only the owner can change the plan.';
  end if;

  case p_action
    when 'activate' then
      perform public.org_set_plan(p_org, 'active', p_seats);
    when 'payment_failed' then
      if public.org_plan_state(p_org) <> 'active' then
        raise exception 'Only an active plan has a payment to fail.';
      end if;
      perform public.org_set_plan(p_org, 'past_due');
    when 'cancel' then
      perform public.org_set_plan(p_org, 'canceled');
    when 'end_trial' then
      update public.org_plans
      set trial_ends_at = least(trial_ends_at, now()), updated_at = now()
      where org_id = p_org and status = 'trial';
    else
      raise exception 'Unknown billing action %', p_action;
  end case;
end;
$$;

-- Joining needs a free seat on a plan that hasn't ended. Re-accepting an
-- updated disclosure doesn't: that person already has their seat.
create or replace function public.accept_org_consent(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  was_invited boolean;
  org_name text;
begin
  select status = 'invited' into was_invited
  from public.org_members
  where org_id = p_org and user_id = auth.uid()
    and (status = 'invited' or consent_version < public.org_disclosure_version());

  if was_invited is null then
    raise exception 'There is nothing to accept.';
  end if;

  if was_invited then
    select name into org_name from public.organizations where id = p_org;
    -- one at a time, so two people can't both take the last seat
    perform 1 from public.org_plans where org_id = p_org for update;
    if public.org_plan_state(p_org) = 'ended' then
      raise exception '%''s plan has ended, so nobody new can join. Ask the owner to renew it.', org_name;
    end if;
    if public.org_seats_used(p_org) >= public.org_seat_limit(p_org) then
      raise exception '% has no free seats. Ask the owner to add seats.', org_name;
    end if;
  end if;

  update public.org_members
  set status = 'active', consented_at = now(), consent_version = public.org_disclosure_version()
  where org_id = p_org and user_id = auth.uid();

  perform public.org_log(p_org, auth.uid(), auth.uid(), case when was_invited then 'joined' else 'reconsented' end);
end;
$$;

-- Starting a shift needs a plan that hasn't ended. Clocking out never does.
create or replace function public.clock_in(p_org uuid, p_checkin_minutes int default null)
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
  if public.org_plan_state(p_org) = 'ended' then
    raise exception 'This organization''s plan has ended, so new shifts can''t start. Ask the owner to renew it. SOS still works.';
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

-- my_orgs() gains the plan. Everyone sees the plan's state (a worker needs
-- to know why they can't clock in); only owners and admins see the dates
-- and seat counts.
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
  next_checkin_due timestamptz,
  plan_state text,
  trial_ends_at timestamptz,
  grace_ends_at timestamptz,
  seat_limit int,
  seats_used int
)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.name, o.type, m.role, m.status, m.consented_at,
         s.id is not null, s.clocked_in_at,
         (m.role = 'worker' and m.status = 'active' and m.consent_version < public.org_disclosure_version()),
         s.checkin_minutes, s.next_checkin_due,
         public.org_plan_state(o.id),
         case when is_admin then p.trial_ends_at end,
         case when is_admin then p.grace_ends_at end,
         case when is_admin then public.org_seat_limit(o.id) end,
         case when is_admin then public.org_seats_used(o.id) end
  from public.org_members m
  join public.organizations o on o.id = m.org_id
  join public.org_plans p on p.org_id = o.id
  cross join lateral (select m.role in ('owner', 'admin') and m.status = 'active' as is_admin) a
  left join public.shifts s
    on s.org_id = m.org_id and s.user_id = m.user_id
   and s.clocked_out_at is null and s.clocked_in_at > now() - public.max_shift_length()
  where m.user_id = auth.uid()
  order by o.name;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'trial_seats()',
    'org_plan_on_create()',
    'org_plan_state(uuid)',
    'org_seat_limit(uuid)',
    'org_seats_used(uuid)',
    'org_set_plan(uuid, text, int)',
    'org_demo_billing(uuid, text, int)',
    'my_orgs()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
  end loop;
  -- internal: an app user calling these directly could read other
  -- organizations' plans or make their own organization "paid"
  revoke all on function public.org_set_plan(uuid, text, int) from authenticated;
  revoke all on function public.org_plan_on_create() from authenticated;
  revoke all on function public.org_plan_state(uuid) from authenticated;
  revoke all on function public.org_seat_limit(uuid) from authenticated;
  revoke all on function public.org_seats_used(uuid) from authenticated;
  grant execute on function public.org_demo_billing(uuid, text, int) to authenticated;
  grant execute on function public.my_orgs() to authenticated;
end $$;
