-- Job sites: places an organization marks (a yard, a client's building) so a
-- worker who arrives at one without clocking in can be reminded to.
--
-- The reminder is the phone's business alone. Workers who turn it on (Work
-- tab, off by default) have their own phone watch the sites with the
-- operating system's geofencing and show a local notification; the arrival is
-- never sent anywhere. So the organization learns nothing it didn't already
-- know, nothing changes in the disclosure, and the database's only job is
-- the list of sites.
--
-- Owners and admins add and remove sites; anyone active in the organization
-- can read its sites (they're workplaces, not anyone's location). At most 20
-- per organization: that is how many regions iOS will watch for one app.

create table public.job_sites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius_m int not null default 150 check (radius_m between 50 and 1000),
  created_at timestamptz not null default now()
);

create index job_sites_org_idx on public.job_sites (org_id);

alter table public.job_sites enable row level security;
-- No policies: read and changed only through the functions below.

create function public.max_job_sites() returns int
language sql immutable as $$ select 20 $$;

-- The organization's sites, for the people who run it.
create function public.org_job_sites(p_org uuid)
returns table (id uuid, name text, latitude double precision, longitude double precision, radius_m int)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(public.org_role_of(p_org) in ('owner', 'admin', 'manager'), false) is not true then
    return;
  end if;
  return query
  select s.id, s.name, s.latitude, s.longitude, s.radius_m
  from public.job_sites s
  where s.org_id = p_org
  order by s.name;
end;
$$;

-- Every site a worker could clock in at: organizations where they're an
-- active worker whose plan hasn't ended. The phone registers these as
-- geofences.
create function public.my_job_sites()
returns table (id uuid, org_id uuid, org_name text, name text, latitude double precision, longitude double precision, radius_m int)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, o.id, o.name, s.name, s.latitude, s.longitude, s.radius_m
  from public.job_sites s
  join public.organizations o on o.id = s.org_id
  join public.org_members m on m.org_id = s.org_id
  where m.user_id = auth.uid() and m.role = 'worker' and m.status = 'active'
    and public.org_plan_state(s.org_id) <> 'ended'
  order by o.name, s.name;
$$;

create function public.add_job_site(
  p_org uuid,
  p_name text,
  p_latitude double precision,
  p_longitude double precision,
  p_radius_m int default 150
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if coalesce(public.org_role_of(p_org) in ('owner', 'admin'), false) is not true then
    raise exception 'Only an owner or admin can add job sites.';
  end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'Give the job site a name of 1 to 80 characters.';
  end if;
  if p_radius_m is null or p_radius_m not between 50 and 1000 then
    raise exception 'Choose a radius between 50 and 1000 meters.';
  end if;
  perform 1 from public.organizations where id = p_org for update;
  if (select count(*) from public.job_sites where org_id = p_org) >= public.max_job_sites() then
    raise exception 'An organization can have up to % job sites.', public.max_job_sites();
  end if;

  insert into public.job_sites (org_id, name, latitude, longitude, radius_m)
  values (p_org, trim(p_name), p_latitude, p_longitude, p_radius_m)
  returning id into new_id;
  return new_id;
end;
$$;

create function public.delete_job_site(p_site uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  site_org uuid;
begin
  select org_id into site_org from public.job_sites where id = p_site;
  if site_org is null then
    return;
  end if;
  if coalesce(public.org_role_of(site_org) in ('owner', 'admin'), false) is not true then
    raise exception 'Only an owner or admin can remove job sites.';
  end if;
  delete from public.job_sites where id = p_site;
end;
$$;

revoke all on function public.max_job_sites() from public, anon;
revoke all on function public.org_job_sites(uuid) from public, anon;
revoke all on function public.my_job_sites() from public, anon;
revoke all on function public.add_job_site(uuid, text, double precision, double precision, int) from public, anon;
revoke all on function public.delete_job_site(uuid) from public, anon;
grant execute on function public.org_job_sites(uuid) to authenticated;
grant execute on function public.my_job_sites() to authenticated;
grant execute on function public.add_job_site(uuid, text, double precision, double precision, int) to authenticated;
grant execute on function public.delete_job_site(uuid) to authenticated;
