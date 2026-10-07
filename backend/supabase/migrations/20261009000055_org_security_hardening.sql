-- Security hardening found by an adversarial review of the organization and
-- SOS work (migrations ...000048 to ...000054). Each item below was
-- reproduced against the live database before being fixed.

-- 1. Internal helpers were callable by any signed-in user.
--
-- `revoke ... from public, anon` doesn't touch the `authenticated` role,
-- which Supabase grants EXECUTE on new functions to by default. So these were
-- reachable through the API by anyone signed in:
--   org_log                  write any row into the audit log (forge or frame)
--   org_overseer_ids,
--   sos_org_recipients       list who oversees any worker / who an SOS reaches
--   org_role_of,
--   org_can_see_worker       look up anyone's role / visibility in any org
--   close_stale_shifts       a maintenance job
-- None of them is used by an RLS policy or called directly by the apps; only
-- other security-definer functions (which run as the owner) call them.
revoke execute on function public.org_log(uuid, uuid, uuid, text) from authenticated;
revoke execute on function public.org_overseer_ids(uuid, uuid) from authenticated;
revoke execute on function public.sos_org_recipients(uuid, timestamptz) from authenticated;
revoke execute on function public.sos_org_only_recipients(uuid, timestamptz) from authenticated;
revoke execute on function public.org_role_of(uuid, uuid) from authenticated;
revoke execute on function public.org_can_see_worker(uuid, uuid) from authenticated;
revoke execute on function public.close_stale_shifts() from authenticated;
revoke execute on function public.notify_org_sos() from authenticated;
revoke execute on function public.org_member_cleanup() from authenticated;
revoke execute on function public.handle_org_owner_deletion() from authenticated;

-- team_members' read policy called team_org(), which turned any team id into
-- its organization id for anyone. Fold the lookup into one function that only
-- answers "am I an admin of this team's organization?".
create function public.is_team_org_admin(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select public.is_org_admin(t.org_id) from public.teams t where t.id = p_team),
    false
  );
$$;

revoke all on function public.is_team_org_admin(uuid) from public, anon;
grant execute on function public.is_team_org_admin(uuid) to authenticated;

drop policy "team_members_select" on public.team_members;
create policy "team_members_select"
  on public.team_members for select
  using (
    user_id = auth.uid()
    or public.is_team_org_admin(team_id)
    or public.is_team_lead(team_id)
  );

revoke execute on function public.team_org(uuid) from authenticated;

-- 2. SOS rows could be rewritten by anyone who could see them.
--
-- The update policy (migration ...000012) lets the sender, any circle-mate,
-- and now an organization's overseers update a row, but didn't limit WHICH
-- columns: they could change the coordinates, message, timestamp, or even
-- reassign the SOS to a different user. Only resolving is meant to be
-- possible, so that's all that's allowed.
revoke update on public.sos_events from authenticated, anon;
grant update (resolved_at, resolved_by) on public.sos_events to authenticated;

-- Resolving is recorded honestly: whoever really did it (not whoever the
-- client claims), at the server's time, and a resolved SOS can't be quietly
-- re-opened. Only applies to people acting through the API; the cron jobs and
-- other trusted code run with no signed-in user and are untouched.
create function public.guard_sos_update()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if old.resolved_at is not null then
    new.resolved_at := old.resolved_at;
    new.resolved_by := old.resolved_by;
  elsif new.resolved_at is not null then
    new.resolved_at := now();
    new.resolved_by := auth.uid();
  else
    new.resolved_by := old.resolved_by;
  end if;
  return new;
end;
$$;

create trigger sos_events_b_guard
  before update on public.sos_events
  for each row execute function public.guard_sos_update();

-- 3. The SOS rate limit could be dodged with a backdated timestamp.
--
-- The limit (migration ...000013) counts rows from the last 10 minutes by
-- created_at, and the insert policy let the client choose created_at, so an
-- SOS stamped hours ago was never counted: 7 of 7 got through in testing,
-- each pushing the sender's circle and (for crews) their managers. The
-- shift-gating of manager alerts also keys off created_at, so a client could
-- have picked which shift an SOS fell in. For people acting through the API
-- the server now sets the time and the fields only the server should set.
-- Named so it runs before the rate limit trigger (alphabetical order).
create function public.normalize_sos_insert()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null then
    new.created_at := now();
    new.resolved_at := null;
    new.resolved_by := null;
    new.notified := false;
    new.last_escalated_at := null;
  end if;
  return new;
end;
$$;

create trigger sos_events_a_normalize
  before insert on public.sos_events
  for each row execute function public.normalize_sos_insert();

-- 4. Moving someone into the worker role must need THEIR acceptance.
--
-- Migration ...000052 marked every non-worker as having accepted the current
-- disclosure, and create_organization does the same for owners. Neither ever
-- saw it as a worker, so demoting an owner, admin or manager to worker made
-- them trackable immediately, with no consent screen. Reset their consent
-- when they enter the worker role: they then show as waiting to accept,
-- can't clock in and can't be seen until they accept it themselves.
update public.org_members set consent_version = 0 where role <> 'worker';

create or replace function public.set_org_member_role(p_org uuid, p_user uuid, p_role text)
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

  update public.org_members
  set role = p_role,
      consent_version = case
        when p_role = 'worker' and target_role <> 'worker' then 0
        else consent_version
      end
  where org_id = p_org and user_id = p_user;

  -- Only managers can lead a team.
  if p_role <> 'manager' then
    update public.team_members tm set is_lead = false
    from public.teams t
    where tm.team_id = t.id and t.org_id = p_org and tm.user_id = p_user;
  end if;

  perform public.org_log(p_org, auth.uid(), p_user, 'role_changed:' || p_role);
end;
$$;

-- 5. Overseers saw "Someone needs help" with no name.
--
-- The apps look up the sender's profile alongside an SOS, but profiles are
-- only readable between circle-mates and a manager isn't a circle-mate of a
-- worker, so the name came back empty. Opening the profile table to
-- overseers would expose far more (phone number, status). This returns just
-- the sender's name and the names of the people who acknowledged it, and only
-- for SOS events the caller oversees through an organization.
create function public.org_sos_details(p_event_ids bigint[])
returns table (event_id bigint, kind text, user_id uuid, full_name text)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, 'sender', e.user_id, p.full_name
  from public.sos_events e
  join public.profiles p on p.id = e.user_id
  where e.id = any (p_event_ids) and public.org_can_see_sos(e.user_id, e.created_at)
  union all
  select e.id, 'ack', a.user_id, p.full_name
  from public.sos_events e
  join public.sos_acknowledgements a on a.sos_event_id = e.id
  join public.profiles p on p.id = a.user_id
  where e.id = any (p_event_ids) and public.org_can_see_sos(e.user_id, e.created_at);
$$;

revoke all on function public.org_sos_details(bigint[]) from public, anon;
grant execute on function public.org_sos_details(bigint[]) to authenticated;
