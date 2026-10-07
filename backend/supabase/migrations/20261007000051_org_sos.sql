-- SOS for work crews. A worker's SOS has always gone to the people who share a
-- circle with them; a manager who isn't in that circle never heard about it.
-- Now, when the worker is CLOCKED IN at the moment they send it, their
-- organization's overseers are alerted too, and can see, acknowledge and
-- resolve it: owners and admins, plus managers who lead a team the worker is
-- on (the same people who can see that worker's location on shift).
--
-- Deliberately shift-gated. The promise to a worker is "nobody at work can
-- see you off shift", and an SOS sent from home on a day off should not
-- quietly reach their employer. Off shift it behaves exactly as before:
-- circles only. An SOS is also a deliberate act by the worker, which is why
-- it can carry their location without going through the audited manager
-- reads the way a manager looking at the live roster does.

-- The overseers of one worker in one organization. No dependence on
-- auth.uid(), so triggers and cron jobs can use it too. Mirrors the rule in
-- org_can_see_worker (migration ...000048): an active, consented worker is
-- overseen by active owners/admins, and by managers leading a team they're on.
create function public.org_overseer_ids(p_org uuid, p_worker uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct r.user_id), '{}'::uuid[])
  from public.org_members w
  join public.org_members r
    on r.org_id = w.org_id and r.status = 'active' and r.user_id <> w.user_id
  where w.org_id = p_org and w.user_id = p_worker
    and w.role = 'worker' and w.status = 'active' and w.consented_at is not null
    and (
      r.role in ('owner', 'admin')
      or (
        r.role = 'manager'
        and exists (
          select 1
          from public.team_members lead
          join public.teams t on t.id = lead.team_id
          join public.team_members tm on tm.team_id = lead.team_id
          where t.org_id = p_org and lead.user_id = r.user_id and lead.is_lead
            and tm.user_id = p_worker
        )
      )
    );
$$;

-- Everyone in any organization who oversees this worker AS OF the moment
-- p_at, i.e. only organizations where the worker had a shift running then.
create function public.sos_org_recipients(p_worker uuid, p_at timestamptz)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct x), '{}'::uuid[])
  from (
    select unnest(public.org_overseer_ids(s.org_id, p_worker)) as x
    from public.shifts s
    where s.user_id = p_worker
      and p_at >= s.clocked_in_at
      and p_at <= least(coalesce(s.clocked_out_at, now()), s.clocked_in_at + public.max_shift_length())
  ) q;
$$;

-- The same set minus anyone who already gets the circle push, so a manager
-- who is also in the worker's family circle isn't alerted twice.
create function public.sos_org_only_recipients(p_worker uuid, p_at timestamptz)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(r), '{}'::uuid[])
  from unnest(public.sos_org_recipients(p_worker, p_at)) r
  where r <> all (public.circle_recipients_all(p_worker));
$$;

-- For the caller: may I see this SOS because of an organization?
create function public.org_can_see_sos(p_worker uuid, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.uid() = any (public.sos_org_recipients(p_worker, p_at)), false);
$$;

-- Visibility and resolving, widened by exactly the organization rule above.
drop policy "sos_events_select" on public.sos_events;
create policy "sos_events_select"
  on public.sos_events for select
  using (
    user_id = auth.uid()
    or public.shares_circle_with(user_id)
    or public.org_can_see_sos(user_id, created_at)
  );

drop policy "sos_events_resolve" on public.sos_events;
create policy "sos_events_resolve"
  on public.sos_events for update
  using (
    user_id = auth.uid()
    or public.shares_circle_with(user_id)
    or public.org_can_see_sos(user_id, created_at)
  )
  with check (
    user_id = auth.uid()
    or public.shares_circle_with(user_id)
    or public.org_can_see_sos(user_id, created_at)
  );

drop policy "sos_acknowledgements_select" on public.sos_acknowledgements;
create policy "sos_acknowledgements_select"
  on public.sos_acknowledgements for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.sos_events e
      where e.id = sos_event_id
        and (
          e.user_id = auth.uid()
          or public.shares_circle_with(e.user_id)
          or public.org_can_see_sos(e.user_id, e.created_at)
        )
    )
  );

-- "I see this, on my way" — latest version (migration ...000032) plus the
-- organization rule.
create or replace function public.acknowledge_sos(p_sos_event_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sender uuid;
  sent_at timestamptz;
  acker_name text;
  inserted boolean;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select user_id, created_at into sender, sent_at from public.sos_events
  where id = p_sos_event_id and resolved_at is null;
  if sender is null then
    raise exception 'This SOS is not active.';
  end if;
  if sender <> auth.uid()
     and not public.shares_circle_with(sender)
     and not public.org_can_see_sos(sender, sent_at) then
    raise exception 'Not in a shared circle.';
  end if;

  insert into public.sos_acknowledgements (sos_event_id, user_id)
  values (p_sos_event_id, auth.uid())
  on conflict (sos_event_id, user_id) do nothing;
  inserted := found;

  if inserted and auth.uid() <> sender then
    select full_name into acker_name from public.profiles where id = auth.uid();
    perform public.send_alert_push(
      array[sender],
      '👀 ' || acker_name || ' saw your SOS',
      'They know and are responding.',
      jsonb_build_object('type', 'sos', 'sosId', p_sos_event_id)
    );
  end if;
end;
$$;

-- Escalation (migration ...000030) re-pushes an unacknowledged SOS to the
-- circle; it now also reaches the organization's overseers.
create or replace function public.escalate_unacknowledged_sos()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  e record;
  sender_name text;
  recipients uuid[];
  n int := 0;
begin
  for e in
    select s.id, s.user_id, s.created_at
    from public.sos_events s
    where s.resolved_at is null
      and s.created_at < now() - interval '3 minutes'
      and (s.last_escalated_at is null or s.last_escalated_at < now() - interval '5 minutes')
      and not exists (select 1 from public.sos_acknowledgements a where a.sos_event_id = s.id)
    for update skip locked
  loop
    select full_name into sender_name from public.profiles where id = e.user_id;
    select coalesce(array_agg(distinct r), '{}'::uuid[]) into recipients
    from unnest(
      public.circle_recipients_all(e.user_id) || public.sos_org_recipients(e.user_id, e.created_at)
    ) r;

    perform public.send_alert_push(
      recipients,
      '🆘 Still no one has responded',
      sender_name || '''s SOS from ' || to_char(now(), 'HH12:MI AM') || ' needs someone to check it.',
      jsonb_build_object('type', 'sos', 'sosId', e.id)
    );
    update public.sos_events set last_escalated_at = now() where id = e.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- The first alert. A failure here must never stop the SOS itself from being
-- recorded, so any error is swallowed.
create function public.notify_org_sos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipients uuid[];
  sender_name text;
  org_name text;
begin
  recipients := public.sos_org_only_recipients(new.user_id, new.created_at);
  if coalesce(array_length(recipients, 1), 0) = 0 then
    return new;
  end if;

  select full_name into sender_name from public.profiles where id = new.user_id;
  select o.name into org_name
  from public.shifts s
  join public.organizations o on o.id = s.org_id
  where s.user_id = new.user_id
    and new.created_at >= s.clocked_in_at
    and new.created_at <= least(coalesce(s.clocked_out_at, now()), s.clocked_in_at + public.max_shift_length())
  order by s.clocked_in_at desc
  limit 1;

  perform public.send_alert_push(
    recipients,
    '🆘 SOS: ' || sender_name || ' needs help',
    sender_name || ' sent an SOS while clocked in' || coalesce(' at ' || org_name, '')
      || '. Open Safe Circle to see where.',
    jsonb_build_object(
      'type', 'sos',
      'sosEventId', new.id,
      'latitude', new.latitude,
      'longitude', new.longitude
    )
  );
  return new;
exception when others then
  return new;
end;
$$;

create trigger sos_events_notify_org
  after insert on public.sos_events
  for each row execute function public.notify_org_sos();

do $$
declare
  f text;
begin
  foreach f in array array[
    'org_overseer_ids(uuid, uuid)', 'sos_org_recipients(uuid, timestamptz)',
    'sos_org_only_recipients(uuid, timestamptz)', 'org_can_see_sos(uuid, timestamptz)',
    'notify_org_sos()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
  end loop;
  -- Policies call org_can_see_sos as the signed-in user, so it needs to be
  -- callable by them; the recipient lists are for triggers and cron only.
  grant execute on function public.org_can_see_sos(uuid, timestamptz) to authenticated;
end $$;
