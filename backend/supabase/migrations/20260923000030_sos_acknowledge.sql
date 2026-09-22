-- SOS acknowledge + escalation. A one-tap SOS is only as good as someone
-- actually seeing it — this closes that gap two ways: circle-mates can tap
-- "I see this, on my way" so the sender knows help is coming, and if
-- *nobody* acknowledges within a few minutes, the alert is re-pushed
-- (louder the second time) instead of silently sitting there.
create table public.sos_acknowledgements (
  sos_event_id bigint not null references public.sos_events (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (sos_event_id, user_id)
);

alter table public.sos_acknowledgements enable row level security;

create policy "sos_acknowledgements_select"
  on public.sos_acknowledgements for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.sos_events e
      where e.id = sos_event_id and (e.user_id = auth.uid() or public.shares_circle_with(e.user_id))
    )
  );

alter publication supabase_realtime add table public.sos_acknowledgements;

create function public.acknowledge_sos(p_sos_event_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sender uuid;
  sender_name text;
  acker_name text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select user_id into sender from public.sos_events
  where id = p_sos_event_id and resolved_at is null;
  if sender is null then
    raise exception 'This SOS is not active.';
  end if;
  if sender <> auth.uid() and not public.shares_circle_with(sender) then
    raise exception 'Not in a shared circle.';
  end if;

  insert into public.sos_acknowledgements (sos_event_id, user_id)
  values (p_sos_event_id, auth.uid())
  on conflict (sos_event_id, user_id) do nothing;

  if auth.uid() <> sender then
    select full_name into acker_name from public.profiles where id = auth.uid();
    select full_name into sender_name from public.profiles where id = sender;
    perform public.send_alert_push(
      array[sender],
      '👀 ' || acker_name || ' saw your SOS',
      'They know and are responding.',
      jsonb_build_object('type', 'sos', 'sosId', p_sos_event_id)
    );
  end if;
end;
$$;

revoke all on function public.acknowledge_sos(bigint) from public, anon;
grant execute on function public.acknowledge_sos(bigint) to authenticated;

-- Escalation: run every minute (same cadence as expire_walks). An unresolved
-- SOS with nobody acknowledged, more than 3 minutes old and not re-pushed in
-- the last 5 minutes, gets pushed again to the circle — plain repetition,
-- since a first push that nobody's seen isn't fixed by anything fancier.
alter table public.sos_events add column last_escalated_at timestamptz;

create function public.escalate_unacknowledged_sos()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  e record;
  sender_name text;
  n int := 0;
begin
  for e in
    select s.id, s.user_id
    from public.sos_events s
    where s.resolved_at is null
      and s.created_at < now() - interval '3 minutes'
      and (s.last_escalated_at is null or s.last_escalated_at < now() - interval '5 minutes')
      and not exists (select 1 from public.sos_acknowledgements a where a.sos_event_id = s.id)
    for update skip locked
  loop
    select full_name into sender_name from public.profiles where id = e.user_id;
    perform public.send_alert_push(
      public.circle_recipients_all(e.user_id),
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

-- circle_recipients() (migration ...000026) takes one circle; SOS isn't
-- circle-scoped (same "anyone who shares a circle with you" rule sos_events
-- itself uses) — this collects everyone across every circle the sender is
-- in, deduplicated.
create function public.circle_recipients_all(p_user_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct cm2.user_id), '{}'::uuid[])
  from public.circle_members cm1
  join public.circle_members cm2
    on cm2.circle_id = cm1.circle_id and cm2.user_id <> cm1.user_id
  where cm1.user_id = p_user_id;
$$;

revoke all on function public.circle_recipients_all(uuid) from public, anon, authenticated;
revoke all on function public.escalate_unacknowledged_sos() from public, anon, authenticated;

select cron.schedule('escalate-sos', '* * * * *', 'select public.escalate_unacknowledged_sos()');
