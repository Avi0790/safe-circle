-- Removes everything scripts/demo_seed.sql made, and nothing else:
--   supabase db query --linked -f scripts/demo_reset.sql
--
-- Demo people are recognised by their email domain (demo.safecircle.invalid,
-- which can never be a real address); the demo organization by its name and
-- by having demo people in it. Deleting the demo accounts deletes their
-- profiles, locations and memberships with them.
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
