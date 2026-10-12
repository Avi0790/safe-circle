-- "Phone has gone quiet." A worker who is clocked in but whose phone hasn't
-- sent a location for a while is exactly the case a manager cares about (dead
-- battery, no signal, app closed, or something worse), and until now it was
-- only visible if someone happened to be looking at the crew screen, as a
-- "may be offline" flag. This pushes it to the people who oversee that
-- worker, once per quiet stretch.
--
-- It's a plain push, not an SOS: a dead battery isn't an emergency, and an
-- SOS also reaches the worker's family circles. Check-ins (migration
-- ...000053) are the opt-in way to be asked "are you OK?"; this is the
-- passive net underneath for everyone, including people who didn't opt in.
--
-- It is a new thing the app does about workers, so it is part of the
-- disclosure and the version is bumped to 3: workers who accepted version 2
-- are asked to accept again before they can be seen (migration ...000052).

create or replace function public.org_disclosure_version()
returns int
language sql
immutable
as $$ select 3 $$;

-- How long without a location, while clocked in, counts as quiet. The crew
-- view flags "may be offline" at 15 minutes; the push waits a little longer so
-- it is rarely the first anyone hears of it, and a brief tunnel or lift
-- doesn't page people.
create function public.quiet_after()
returns interval
language sql
immutable
as $$ select interval '20 minutes' $$;

-- Set when an alert has gone out for the current quiet stretch; cleared when
-- the phone reports again, so a later stretch alerts again.
alter table public.shifts add column quiet_alerted_at timestamptz;

create function public.alert_quiet_phones()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  ref timestamptz;
  who_name text;
  mins int;
  n int := 0;
begin
  -- A stretch is over once the phone has reported something newer than the
  -- alert (a ping's recorded_at is the fix time, so late-flushed old pings
  -- from a queued backlog don't count as being back).
  update public.shifts sh
  set quiet_alerted_at = null
  where sh.clocked_out_at is null
    and sh.quiet_alerted_at is not null
    and exists (
      select 1 from public.locations l
      where l.user_id = sh.user_id and l.recorded_at > sh.quiet_alerted_at
    );

  for s in
    select sh.id, sh.org_id, sh.user_id, sh.clocked_in_at,
           (select max(l.recorded_at) from public.locations l
             where l.user_id = sh.user_id and l.recorded_at >= sh.clocked_in_at) as last_ping
    from public.shifts sh
    where sh.clocked_out_at is null
      and sh.clocked_in_at > now() - public.max_shift_length()
      and sh.quiet_alerted_at is null
    for update of sh skip locked
  loop
    -- Quiet since the last ping, or since clocking in if none ever arrived
    -- (clocked in but the phone never started sending is worth knowing too).
    ref := coalesce(s.last_ping, s.clocked_in_at);
    continue when ref > now() - public.quiet_after();

    mins := floor(extract(epoch from now() - ref) / 60);
    select full_name into who_name from public.profiles where id = s.user_id;

    perform public.send_alert_push(
      public.org_overseer_ids(s.org_id, s.user_id),
      '📵 ' || who_name || ' has gone quiet',
      who_name || ' hasn''t sent a location for ' || mins || ' minutes while clocked in'
        || case when s.last_ping is null then ' (since they clocked in).' else '.' end
        || ' Their phone may be off or out of signal.',
      jsonb_build_object('type', 'quiet_phone', 'shiftId', s.id, 'userId', s.user_id)
    );

    update public.shifts set quiet_alerted_at = now() where id = s.id;
    n := n + 1;
  end loop;

  return n;
end;
$$;

select cron.schedule('quiet-phones', '*/3 * * * *', 'select public.alert_quiet_phones()');

-- Only the scheduler runs the sweep; nobody signed in should be able to
-- trigger a pass over everyone's shifts (see migration ...000055).
revoke all on function public.alert_quiet_phones() from public, anon, authenticated;
revoke all on function public.quiet_after() from public, anon, authenticated;
