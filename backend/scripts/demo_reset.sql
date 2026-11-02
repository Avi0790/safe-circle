-- Removes everything scripts/demo_seed.sql made, and nothing else:
--   supabase db query --linked -f scripts/demo_reset.sql
--
-- Demo people are recognised by their email domain (demo.safecircle.invalid,
-- which can never be a real address); the demo organization by its name and
-- by having demo people in it. Deleting the organization takes its teams,
-- incident reports, safety log and audit with it; deleting the demo accounts
-- takes their profiles, locations, SOS alerts and memberships.
do $$
declare
  o uuid;
begin
  for o in
    select distinct org.id
    from public.organizations org
    join public.org_members m on m.org_id = org.id
    join auth.users u on u.id = m.user_id
    where org.name = 'Demo Crew' and u.email like '%@demo.safecircle.invalid'
  loop
    -- shifts first: the member-cleanup trigger edits them (migration ...000067)
    delete from public.shifts where org_id = o;
    delete from public.org_members where org_id = o;
    delete from public.organizations where id = o; -- teams, audit, plan, job sites cascade
  end loop;
  delete from auth.users where email like '%@demo.safecircle.invalid';
end $$;
