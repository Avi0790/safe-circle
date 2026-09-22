-- Auto-delete history: each person picks how long their own trail is kept
-- (1 day / 7 days / 30 days / forever). Life360 keeps location history for
-- as long as the plan allows; this puts the choice — and the deletion —
-- in the person's own hands, enforced by the database itself rather than
-- a setting that just hides old rows in the UI.
--
-- null = keep forever (existing behavior for every current row).
alter table public.profiles add column history_retention_days int
  check (history_retention_days is null or history_retention_days in (1, 7, 30));

create function public.set_history_retention(p_days int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_days is not null and p_days not in (1, 7, 30) then
    raise exception 'Choose 1, 7, 30 days, or forever.';
  end if;
  update public.profiles set history_retention_days = p_days where id = auth.uid();
end;
$$;

revoke all on function public.set_history_retention(int) from public, anon;
grant execute on function public.set_history_retention(int) to authenticated;

-- Run once a day. Deletes pings older than each person's own retention
-- window, but never the single most recent row for anyone — the live map
-- pin (via latest_locations) must never disappear just because someone set
-- a 1-day retention and then went quiet for longer than that.
create function public.purge_old_locations()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  with latest as (
    select distinct on (user_id) user_id, id
    from public.locations
    order by user_id, recorded_at desc
  ),
  doomed as (
    select l.id
    from public.locations l
    join public.profiles p on p.id = l.user_id
    where p.history_retention_days is not null
      and l.recorded_at < now() - make_interval(days => p.history_retention_days)
      and l.id not in (select id from latest)
  )
  delete from public.locations where id in (select id from doomed);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.purge_old_locations() from public, anon, authenticated;

select cron.schedule('purge-old-locations', '17 4 * * *', 'select public.purge_old_locations()');
