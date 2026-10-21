-- Timesheets keep people who have left. A worker who leaves (or is removed)
-- mid-week still needs paying for the hours they worked, but org_shifts()
-- only listed current workers, so those hours vanished from timesheets and
-- the shift CSV. The shifts were never deleted (leaving only closes an open
-- one), just hidden.
--
-- Now owners and admins see every shift worked in their organization,
-- including by people no longer in it. Managers still see only current
-- workers on the teams they lead. It is shift times only: where anyone was is
-- still visible only while they're clocked in and a member (org_worker_track,
-- org_live_roster are unchanged), and nothing older than 90 days is listed.
-- Deleting an account still deletes its shifts.
--
-- It changes what an organization can see about someone, so it is in the
-- disclosure and the version is bumped to 4: workers who accepted version 3
-- are asked to accept again before they can clock in or be seen (migration
-- ...000052), the same as when the quiet-phone alert was added (...000056).

create or replace function public.org_disclosure_version()
returns int
language sql
immutable
as $$ select 4 $$;

drop function public.org_shifts(uuid, int, int);

create function public.org_shifts(p_org uuid, p_days int default 7, p_limit int default 100)
returns table (
  shift_id bigint,
  user_id uuid,
  full_name text,
  clocked_in_at timestamptz,
  ended_at timestamptz,
  is_open boolean,
  -- false for someone who has since left the organization
  is_current boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := public.org_role_of(p_org);
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if coalesce(caller_role in ('owner', 'admin', 'manager'), false) is not true then
    return;
  end if;
  if p_days is null or p_days < 1 or p_days > 90 then p_days := 7; end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then p_limit := 100; end if;

  return query
  select s.id, s.user_id, p.full_name, s.clocked_in_at,
         least(coalesce(s.clocked_out_at, now()), s.clocked_in_at + public.max_shift_length()),
         (s.clocked_out_at is null and s.clocked_in_at > now() - public.max_shift_length()),
         exists (
           select 1 from public.org_members m
           where m.org_id = p_org and m.user_id = s.user_id and m.role = 'worker' and m.status = 'active'
         )
  from public.shifts s
  join public.profiles p on p.id = s.user_id
  where s.org_id = p_org
    and s.clocked_in_at > now() - make_interval(days => p_days)
    and (caller_role in ('owner', 'admin') or public.org_can_see_worker(p_org, s.user_id))
  order by s.clocked_in_at desc
  limit p_limit;
end;
$$;

revoke all on function public.org_shifts(uuid, int, int) from public, anon;
grant execute on function public.org_shifts(uuid, int, int) to authenticated;
