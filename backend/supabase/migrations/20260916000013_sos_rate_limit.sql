-- Security fix: sos_events had no rate limiting. A malicious or buggy
-- client could spam SOS alerts to an entire circle, draining the Expo
-- push quota and desensitizing families to real alerts. Cap it at 3
-- per 10 minutes per user.
--
-- A BEFORE INSERT trigger that counts existing (already-committed) rows,
-- not a mutable counter table, deliberately — avoids the exact rollback
-- pitfall found while fixing invite-code rate limiting (migration
-- ...000010): there's no separate counter state here that a later
-- exception could undo, since we're only ever counting rows that already
-- committed in earlier, separate transactions.
create function public.enforce_sos_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_count int;
begin
  select count(*) into recent_count
  from public.sos_events
  where user_id = new.user_id
    and created_at > now() - interval '10 minutes';

  if recent_count >= 3 then
    raise exception 'Too many SOS alerts. Wait a few minutes before sending another.';
  end if;

  return new;
end;
$$;

create trigger sos_events_rate_limit
  before insert on public.sos_events
  for each row execute function public.enforce_sos_rate_limit();
