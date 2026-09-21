-- Temporary sharing: share your location for a fixed window (1h, 2h, 8h...)
-- instead of "until I remember to turn it off". The limit lives in the
-- database, not just the app: once the window closes, nobody else can read
-- your locations and your phone can't write new ones, even if the app was
-- force-quit or the background task is still running.
--
-- profiles.share_until:
--   null        -> normal always-on sharing (every existing row; no change)
--   future time -> sharing until then
--   past time   -> sharing ended: circle-mates see nothing
alter table public.profiles add column share_until timestamptz;

-- security definer so it can read profiles from inside a locations policy
-- without recursing into profiles' own RLS.
create function public.is_sharing(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.share_until is null or p.share_until > now()
     from public.profiles p where p.id = target),
    true
  );
$$;

-- Reading: you always see your own history; circle-mates only see you
-- while you're sharing.
drop policy "locations_select_self_or_circlemate" on public.locations;
create policy "locations_select_self_or_circlemate"
  on public.locations for select
  using (
    user_id = auth.uid()
    or (public.shares_circle_with(user_id) and public.is_sharing(user_id))
  );

-- Writing: the important half. If pings recorded after the window closed
-- were merely hidden, they'd all become visible again the next time you
-- started sharing. Refusing them means the data never exists.
drop policy "locations_insert_self" on public.locations;
create policy "locations_insert_self"
  on public.locations for insert
  with check (user_id = auth.uid() and public.is_sharing(auth.uid()));

-- Start, change, or end a sharing window using the server's clock (a phone
-- with a wrong clock can't stretch or shorten it).
--   p_minutes null -> always-on
--   p_minutes 0    -> end sharing right now
--   p_minutes > 0  -> share for that long (max 24 hours)
create function public.set_share_window(p_minutes int)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  until_ts timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if p_minutes is null then
    until_ts := null;
  elsif p_minutes <= 0 then
    until_ts := now();
  elsif p_minutes > 1440 then
    raise exception 'A sharing window can be at most 24 hours.';
  else
    until_ts := now() + make_interval(mins => p_minutes);
  end if;

  update public.profiles set share_until = until_ts where id = auth.uid();
  return until_ts;
end;
$$;

revoke all on function public.set_share_window(int) from public, anon;
grant execute on function public.set_share_window(int) to authenticated;
