-- Bug fix (caught in a rolled-back-transaction test of ...000030): tapping
-- "I'm on my way" a second time on the same SOS re-pushed the sender even
-- though the acknowledgement itself was a no-op (`on conflict do nothing`
-- doesn't tell you whether it inserted) — repeated taps would have spammed
-- them. Only push when the insert actually added a new row.
create or replace function public.acknowledge_sos(p_sos_event_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sender uuid;
  acker_name text;
  inserted boolean;
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
