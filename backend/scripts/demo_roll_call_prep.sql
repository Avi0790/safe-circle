-- For scripts/demo_roll_call.sh: every demo worker on shift (with a position
-- at a job site so they show on the crew map), and any earlier demo roll call
-- closed so a new one can start. Changes are kept; it ends by saying how
-- many demo workers are on shift.
do $$
declare
  org uuid;
  r record;
begin
  select o.id into org from public.organizations o
  where o.name = 'Demo Crew'
    and exists (select 1 from public.org_members m join auth.users u on u.id = m.user_id
                where m.org_id = o.id and u.email like '%@demo.safecircle.invalid')
  limit 1;
  if org is null then
    raise exception 'RESULT FAIL no Demo Crew yet: run scripts/demo_seed.sql first';
  end if;

  update public.org_roll_calls set closed_at = now() where org_id = org and closed_at is null;

  for r in
    select u.id, row_number() over (order by u.email) as k
    from auth.users u join public.org_members m on m.user_id = u.id and m.org_id = org and m.role = 'worker'
    where u.email like 'demo.%@demo.safecircle.invalid'
  loop
    continue when exists (select 1 from public.shifts where user_id = r.id and clocked_out_at is null);
    -- quiet_alerted_at set: a demo phone "going quiet" mustn't page anyone
    insert into public.shifts (org_id, user_id, clocked_in_at, quiet_alerted_at)
    values (org, r.id, now() - make_interval(mins => (40 + r.k * 7)::int), now());
    insert into public.locations (user_id, latitude, longitude, accuracy, battery_level, speed, recorded_at)
    values (r.id, 35.8423 + (r.k % 2) * -0.0226 + r.k * 0.0003, -90.6743 - (r.k % 2) * 0.006 - r.k * 0.0003, 8, 0.6, 0, now());
  end loop;
end $$;
select format('%s demo workers on shift', count(*)) as result
from public.shifts s join auth.users u on u.id = s.user_id
where s.clocked_out_at is null and u.email like 'demo.%@demo.safecircle.invalid';
