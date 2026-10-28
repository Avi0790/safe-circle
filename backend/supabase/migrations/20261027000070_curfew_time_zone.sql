-- Curfew in the person's own time zone. Until now check_curfews() compared
-- the curfew time (and "already alerted today") with UTC, a simplification
-- noted in ...000037: in Arkansas a 10:00 PM curfew fired at about 5:00 PM.
--
-- Each curfew now stores the phone's IANA time zone (America/Chicago), and
-- the check compares with the local time and date there. A named zone, not
-- an offset, so daylight saving is handled by Postgres. Curfews saved
-- before this keep 'UTC' (their old behaviour) until they're saved again;
-- the app sends the zone every time it saves. An app that doesn't send one
-- (older versions) gets UTC, as before.

alter table public.curfews add column time_zone text not null default 'UTC';

drop function public.set_curfew(uuid, time);

create function public.set_curfew(p_place_id uuid, p_curfew_time time, p_time_zone text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  circle uuid;
  zone text := coalesce(nullif(trim(p_time_zone), ''), 'UTC');
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_curfew_time is null then
    raise exception 'Choose a time.';
  end if;
  if not exists (select 1 from pg_timezone_names where name = zone) then
    raise exception 'Unknown time zone %', zone;
  end if;

  select circle_id into circle from public.places where id = p_place_id;
  if circle is null or not public.is_member_of(circle) then
    raise exception 'Place not found.';
  end if;

  insert into public.curfews (user_id, place_id, curfew_time, time_zone, last_alerted_date)
  values (auth.uid(), p_place_id, p_curfew_time, zone, null)
  on conflict (user_id) do update
    set place_id = excluded.place_id,
        curfew_time = excluded.curfew_time,
        time_zone = excluded.time_zone,
        -- a changed curfew is a fresh start (see ...000037)
        last_alerted_date = null;
end;
$$;

revoke all on function public.set_curfew(uuid, time, text) from public, anon;
grant execute on function public.set_curfew(uuid, time, text) to authenticated;

-- Every 5 minutes (the cron job from ...000037 calls this by name): anyone
-- whose curfew has passed today, in their own time zone, who hasn't been
-- alerted on today and isn't at their curfew place, gets their circle told
-- once.
create or replace function public.check_curfews()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  is_home boolean;
  who_name text;
  place_name text;
  n int := 0;
begin
  for c in
    select *, (now() at time zone time_zone) as local_now
    from public.curfews
    where curfew_time <= (now() at time zone time_zone)::time
      and (last_alerted_date is null or last_alerted_date <> (now() at time zone time_zone)::date)
    for update skip locked
  loop
    select is_inside into is_home
    from public.place_membership_state
    where place_id = c.place_id and user_id = c.user_id;

    if coalesce(is_home, false) then
      continue;
    end if;

    select full_name into who_name from public.profiles where id = c.user_id;
    select name into place_name from public.places where id = c.place_id;

    perform public.send_alert_push(
      public.circle_recipients_all(c.user_id),
      '⏰ ' || who_name || ' missed curfew',
      'Not at ' || place_name || ' by ' || to_char(c.curfew_time, 'HH12:MI AM') || ' yet.',
      jsonb_build_object('type', 'curfew', 'userId', c.user_id)
    );

    update public.curfews
    set last_alerted_date = c.local_now::date
    where user_id = c.user_id;
    n := n + 1;
  end loop;

  return n;
end;
$$;

revoke all on function public.check_curfews() from public, anon, authenticated;
