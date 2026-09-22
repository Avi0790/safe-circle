-- "Check on me": Walk me home's sibling for when there's no destination to
-- arrive at — studying alone at night, a first date, a solo hike with no
-- particular endpoint. Set a timer and an optional note; if you don't tap
-- "I'm safe" before it runs out, an SOS fires automatically at your last
-- known location, same protection as Walk me home for the moment you can't
-- act. Deliberately a separate table from `walks` rather than making
-- place_id nullable there — walks' schema (dest_latitude/longitude,
-- arrive_radius_meters, the arrival trigger) is entirely built around
-- having a destination, and retrofitting it would be riskier than a small
-- table with none of that.
create table public.safety_timers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  circle_id uuid not null references public.circles (id) on delete cascade,
  label text,
  expected_by timestamptz not null,
  -- active  -> timer running
  -- safe    -> person ended it themselves ("I'm safe")
  -- overdue -> timer ran out, SOS sent; still open until they check in
  status text not null default 'active' check (status in ('active', 'safe', 'overdue')),
  sos_event_id bigint references public.sos_events (id) on delete set null,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create unique index safety_timers_one_open_per_user
  on public.safety_timers (user_id) where status = 'active';
create index safety_timers_expiry_idx
  on public.safety_timers (expected_by) where status = 'active';

alter table public.safety_timers enable row level security;

create policy "safety_timers_select"
  on public.safety_timers for select
  using (user_id = auth.uid() or public.is_member_of(circle_id));

alter publication supabase_realtime add table public.safety_timers;

-- No write policies — only the functions below change a row, so the
-- timer, status and SOS link can't be tampered with from a client (same
-- reasoning as `walks`).

create function public.start_safety_timer(p_circle_id uuid, p_label text, p_minutes int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  who_name text;
  new_id uuid;
  old_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_member_of(p_circle_id) then
    raise exception 'Not a member of this circle.';
  end if;
  if p_label is not null and length(p_label) > 60 then
    raise exception 'Keep the note under 60 characters.';
  end if;
  if p_minutes is null or p_minutes < 5 or p_minutes > 480 then
    raise exception 'Choose between 5 minutes and 8 hours.';
  end if;

  -- Starting a new timer ends any earlier one left open, same as start_walk.
  select id into old_id from public.safety_timers where user_id = auth.uid() and status = 'active';
  if old_id is not null then
    update public.safety_timers set status = 'safe', ended_at = now() where id = old_id;
  end if;

  insert into public.safety_timers (user_id, circle_id, label, expected_by)
  values (auth.uid(), p_circle_id, nullif(trim(p_label), ''), now() + make_interval(mins => p_minutes))
  returning id into new_id;

  select full_name into who_name from public.profiles where id = auth.uid();
  perform public.send_alert_push(
    public.circle_recipients(p_circle_id, auth.uid()),
    '⏱️ ' || who_name || ' asked to be checked on',
    coalesce(nullif(trim(p_label), ''), 'No note') || ' — due in ' || p_minutes || ' min.',
    jsonb_build_object('type', 'safety_timer', 'timerId', new_id, 'circleId', p_circle_id)
  );

  return new_id;
end;
$$;

create function public.end_safety_timer(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.safety_timers;
  who_name text;
begin
  select * into t from public.safety_timers where id = p_id and user_id = auth.uid();
  if not found then
    raise exception 'Timer not found.';
  end if;
  if t.status = 'safe' then
    return;
  end if;

  update public.safety_timers set status = 'safe', ended_at = now() where id = t.id;
  if t.sos_event_id is not null then
    update public.sos_events
    set resolved_at = now(), resolved_by = t.user_id
    where id = t.sos_event_id and resolved_at is null;
  end if;

  select full_name into who_name from public.profiles where id = t.user_id;
  perform public.send_alert_push(
    public.circle_recipients(t.circle_id, t.user_id),
    '✅ ' || who_name || ' checked in',
    'They''re safe.',
    jsonb_build_object('type', 'safety_timer', 'timerId', t.id, 'circleId', t.circle_id)
  );
end;
$$;

create function public.extend_safety_timer(p_id uuid, p_minutes int)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  new_deadline timestamptz;
begin
  if p_minutes is null or p_minutes < 1 or p_minutes > 120 then
    raise exception 'Extend by 1 to 120 minutes.';
  end if;

  update public.safety_timers
  set expected_by = expected_by + make_interval(mins => p_minutes)
  where id = p_id
    and user_id = auth.uid()
    and status = 'active'
    and expected_by + make_interval(mins => p_minutes) <= created_at + interval '10 hours'
  returning expected_by into new_deadline;

  if not found then
    raise exception 'This timer can''t be extended.';
  end if;
  return new_deadline;
end;
$$;

-- The timer, same pg_cron pattern as expire_walks(): a timer past its
-- deadline raises a normal SOS at the person's last known location.
create function public.expire_safety_timers()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  loc record;
  sos_id bigint;
  who_name text;
  n int := 0;
begin
  for t in
    select * from public.safety_timers
    where status = 'active' and expected_by < now()
    for update skip locked
  loop
    select latitude, longitude into loc
    from public.locations
    where user_id = t.user_id
    order by recorded_at desc
    limit 1;

    sos_id := null;
    if loc.latitude is not null then
      begin
        insert into public.sos_events (user_id, latitude, longitude, message)
        values (
          t.user_id, loc.latitude, loc.longitude,
          'Automatic alert: didn''t check in' || coalesce(' (' || t.label || ')', '')
            || ' before their safety timer ran out. This is their last known location.'
        )
        returning id into sos_id;
      exception when others then
        -- e.g. the SOS rate limit already tripped — still mark the timer
        -- overdue so this row doesn't fail every minute forever.
        sos_id := null;
      end;
    end if;

    update public.safety_timers set status = 'overdue', sos_event_id = sos_id where id = t.id;

    select full_name into who_name from public.profiles where id = t.user_id;
    perform public.send_alert_push(
      array[t.user_id],
      '⏰ Your check-on-me timer ran out',
      'Your circle was alerted. Open Safe Circle and tap "I''m safe" if you''re okay.',
      jsonb_build_object('type', 'safety_timer', 'timerId', t.id, 'circleId', t.circle_id)
    );
    n := n + 1;
  end loop;

  return n;
end;
$$;

revoke all on function public.start_safety_timer(uuid, text, int) from public, anon;
revoke all on function public.end_safety_timer(uuid) from public, anon;
revoke all on function public.extend_safety_timer(uuid, int) from public, anon;
revoke all on function public.expire_safety_timers() from public, anon, authenticated;
grant execute on function public.start_safety_timer(uuid, text, int) to authenticated;
grant execute on function public.end_safety_timer(uuid) to authenticated;
grant execute on function public.extend_safety_timer(uuid, int) to authenticated;

select cron.schedule('expire-safety-timers', '* * * * *', 'select public.expire_safety_timers()');
