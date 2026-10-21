-- The platform owner's dashboard: how Safe Circle is doing as a whole, in
-- numbers only. Whoever runs the server can technically read everything, so
-- this is built so the owner's own screen never has to: platform_stats()
-- returns counts and sums, never a name, an email, a location, a message or
-- an id. Even a bug in the page can't show more than the database sends.
--
-- Who is a platform admin lives in platform_admins, which has no policies:
-- the app can't read or change it. Grant it from the SQL editor or the CLI
-- (deliberately not in a migration, so no one's email is in the repo):
--
--   insert into public.platform_admins (user_id)
--   select id from auth.users where email = 'you@example.com';

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;
-- no policies: invisible and read-only to every app user

-- Whether the signed-in person is a platform admin, so the web app knows
-- whether to show the Platform tab. Says nothing about anyone else.
create function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

-- What one worker seat costs per month, for the revenue estimate. The demo
-- price; real billing would read it from the payment provider.
create function public.seat_price_cents()
returns int
language sql
immutable
as $$ select 400 $$;

create function public.platform_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
  push_failures int;
begin
  if not public.is_platform_admin() then
    raise exception 'Only the platform owner can see this.';
  end if;

  -- pg_net keeps recent webhook responses for a few hours; a server without
  -- it (or a changed schema) just reports null here instead of failing.
  begin
    execute $q$
      select count(*)::int from net._http_response
      where created > now() - interval '24 hours'
        and (timed_out or status_code is null or status_code >= 400)
    $q$ into push_failures;
  exception when others then
    push_failures := null;
  end;

  with plans as (
    select public.org_plan_state(p.org_id) as state, p.paid_seats, p.org_id
    from public.org_plans p
  )
  select jsonb_build_object(
    'generated_at', now(),
    'seat_price_cents', public.seat_price_cents(),
    'accounts', jsonb_build_object(
      'total', (select count(*) from auth.users),
      'new_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
      'active_24h', (select count(distinct user_id) from public.locations where recorded_at > now() - interval '24 hours'),
      'signups_14d', (
        select jsonb_agg(jsonb_build_object('day', d::date, 'count', coalesce(c.n, 0)) order by d)
        from generate_series(current_date - 13, current_date, interval '1 day') d
        left join (
          select created_at::date as day, count(*) as n
          from auth.users
          where created_at >= current_date - 13
          group by 1
        ) c on c.day = d::date
      )
    ),
    'circles', jsonb_build_object(
      'total', (select count(*) from public.circles),
      'avg_size', (
        select coalesce(round(avg(n)::numeric, 1), 0)
        from (select count(*) as n from public.circle_members group by circle_id) s
      )
    ),
    'work', jsonb_build_object(
      'organizations', (select count(*) from plans),
      'trial', (select count(*) from plans where state = 'trial'),
      'active', (select count(*) from plans where state = 'active'),
      'grace', (select count(*) from plans where state = 'grace'),
      'ended', (select count(*) from plans where state = 'ended'),
      'paid_seats', (select coalesce(sum(paid_seats), 0) from plans where state in ('active', 'grace')),
      'workers', (select count(*) from public.org_members where role = 'worker' and status = 'active'),
      'on_shift', (
        select count(*) from public.shifts
        where clocked_out_at is null and clocked_in_at > now() - public.max_shift_length()
      ),
      'monthly_revenue_cents', (
        select coalesce(sum(paid_seats), 0) * public.seat_price_cents()
        from plans where state in ('active', 'grace')
      )
    ),
    'safety', jsonb_build_object(
      'sos_7d', (select count(*) from public.sos_events where created_at > now() - interval '7 days'),
      'sos_7d_acknowledged', (
        select count(*) from public.sos_events e
        where e.created_at > now() - interval '7 days'
          and exists (select 1 from public.sos_acknowledgements a where a.sos_event_id = e.id)
      ),
      'sos_open', (select count(*) from public.sos_events where resolved_at is null)
    ),
    'health', jsonb_build_object('push_failures_24h', push_failures)
  ) into result;

  return result;
end;
$$;

revoke all on function public.is_platform_admin() from public, anon;
revoke all on function public.platform_stats() from public, anon;
revoke all on function public.seat_price_cents() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.platform_stats() to authenticated;
