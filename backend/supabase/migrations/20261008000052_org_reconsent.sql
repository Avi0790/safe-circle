-- Re-consent. A worker consents to a specific disclosure (what managers can
-- see, SOS, check-ins). When that text changes in a way that matters, workers
-- who agreed to the old version must agree to the new one before they can be
-- seen again — otherwise "you consented" would quietly mean "you consented to
-- something else". org_disclosure_version() is the version current right
-- now; bump it in the same change as the disclosure text in the app
-- (mobile/lib/orgInfo.ts).
--
-- Version 2: adds that an SOS sent while clocked in alerts the people who
-- oversee you (migration ...000051) and that scheduled check-ins can alert
-- them when missed (migration ...000053). Version 1 is everyone who accepted
-- before that, so they're asked again.
create function public.org_disclosure_version()
returns int
language sql
immutable
as $$ select 2 $$;

alter table public.org_members add column consent_version int not null default 1;

-- Owners, admins and managers aren't tracked, so their consent version
-- doesn't gate anything; keep the owner's row current for tidiness.
update public.org_members set consent_version = 2 where role <> 'worker';

-- Same rule as before plus: the worker's consent must be to the CURRENT
-- disclosure.
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

create or replace function public.org_overseer_ids(p_org uuid, p_worker uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct r.user_id), '{}'::uuid[])
  from public.org_members w
  join public.org_members r
    on r.org_id = w.org_id and r.status = 'active' and r.user_id <> w.user_id
  where w.org_id = p_org and w.user_id = p_worker
    and w.role = 'worker' and w.status = 'active' and w.consented_at is not null
    and w.consent_version >= public.org_disclosure_version()
    and (
      r.role in ('owner', 'admin')
      or (
        r.role = 'manager'
        and exists (
          select 1
          from public.team_members lead
          join public.teams t on t.id = lead.team_id
          join public.team_members tm on tm.team_id = lead.team_id
          where t.org_id = p_org and lead.user_id = r.user_id and lead.is_lead
            and tm.user_id = p_worker
        )
      )
    );
$$;

-- Accepting records the version. Works for a first-time invitation and for a
-- worker re-accepting an updated disclosure.
create or replace function public.accept_org_consent(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  was_invited boolean;
begin
  select status = 'invited' into was_invited
  from public.org_members
  where org_id = p_org and user_id = auth.uid()
    and (status = 'invited' or consent_version < public.org_disclosure_version());

  if was_invited is null then
    raise exception 'There is nothing to accept.';
  end if;

  update public.org_members
  set status = 'active', consented_at = now(), consent_version = public.org_disclosure_version()
  where org_id = p_org and user_id = auth.uid();

  perform public.org_log(p_org, auth.uid(), auth.uid(), case when was_invited then 'joined' else 'reconsented' end);
end;
$$;

create or replace function public.create_organization(p_name text, p_type text default 'field_crew')
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

  insert into public.org_members (org_id, user_id, role, status, consented_at, consent_version)
  values (new_org, auth.uid(), 'owner', 'active', now(), public.org_disclosure_version());

  return query select new_org, plain_code;
end;
$$;

-- What the admin's roster shows: a worker who hasn't accepted the current
-- disclosure appears as waiting to accept, since nobody can see them either
-- way. Same columns and rules as before.
create or replace function public.org_roster(p_org uuid)
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
  select m.user_id, p.full_name, m.role,
         case
           when m.role = 'worker' and m.status = 'active'
                and m.consent_version < public.org_disclosure_version() then 'invited'
           else m.status
         end,
         m.consented_at,
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
