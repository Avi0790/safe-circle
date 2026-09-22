-- Curfew: "alert my circle if I'm not home by 10pm" — set once, then
-- entirely automatic. Reuses place_membership_state (migration ...000006)
-- for "are they there", so this is a thin scheduling layer on top of
-- geofencing that already exists, not a second location-tracking mechanism.
--
-- Known simplification: curfew_time is compared against UTC clock time,
-- not the person's local timezone — profiles has no timezone column, and
-- adding real timezone handling is out of scope for a capstone demo. Fine
-- for one timezone (the target use case: a family in one place); documented
-- here and in mobile/README.md rather than silently wrong.
create table public.curfews (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  place_id uuid not null references public.places (id) on delete cascade,
  curfew_time time not null,
  -- Set once an alert has fired for a given day, so the 5-minute check
  -- below doesn't re-alert the circle every tick for the rest of the day.
  last_alerted_date date,
  created_at timestamptz not null default now()
);

alter table public.curfews enable row level security;

-- Personal setting — only the owner can see it, same reasoning as
-- hidden_from: what time someone is expected home isn't something every
-- circle-mate needs to be able to read, only to be told about *when it's
-- missed* (which the alert itself does).
create policy "curfews_select_owner"
  on public.curfews for select
  using (user_id = auth.uid());

-- No write policies — only set_curfew()/clear_curfew() below change it.

create function public.set_curfew(p_place_id uuid, p_curfew_time time)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  circle uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_curfew_time is null then
    raise exception 'Choose a time.';
  end if;

  select circle_id into circle from public.places where id = p_place_id;
  if circle is null or not public.is_member_of(circle) then
    raise exception 'Place not found.';
  end if;

  insert into public.curfews (user_id, place_id, curfew_time, last_alerted_date)
  values (auth.uid(), p_place_id, p_curfew_time, null)
  on conflict (user_id) do update
    set place_id = excluded.place_id,
        curfew_time = excluded.curfew_time,
        -- Changing the curfew (a new time or place) is a fresh start — an
        -- alert already sent today under the old settings shouldn't
        -- suppress one that the new settings would trigger.
        last_alerted_date = null;
end;
$$;

create function public.clear_curfew()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.curfews where user_id = auth.uid();
end;
$$;

revoke all on function public.set_curfew(uuid, time) from public, anon;
revoke all on function public.clear_curfew() from public, anon;
grant execute on function public.set_curfew(uuid, time) to authenticated;
grant execute on function public.clear_curfew() to authenticated;

-- Run every 5 minutes. For anyone whose curfew has passed today and who
-- hasn't been alerted on yet, checks whether they're currently inside
-- their curfew place — if not, alerts their circle once and marks today
-- as alerted.
create function public.check_curfews()
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
    select *
    from public.curfews
    where curfew_time <= (now() at time zone 'utc')::time
      and (last_alerted_date is null or last_alerted_date <> (now() at time zone 'utc')::date)
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
    set last_alerted_date = (now() at time zone 'utc')::date
    where user_id = c.user_id;
    n := n + 1;
  end loop;

  return n;
end;
$$;

revoke all on function public.check_curfews() from public, anon, authenticated;

select cron.schedule('check-curfews', '*/5 * * * *', 'select public.check_curfews()');
