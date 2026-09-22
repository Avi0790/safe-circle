-- Auto status: arriving at a saved place sets your quick status on its own
-- ("🏠 Home", "📚 In class") — no Life360 equivalent, and it's essentially
-- free given what's already tracked: evaluate_geofences() (migration
-- ...000006) already logs every arrive/leave transition to
-- geofence_events, so this just reacts to that log instead of duplicating
-- the geofence math.
--
-- Never overrides a status you set yourself: status_auto distinguishes "the
-- app set this" from "I picked this", and arriving somewhere only ever
-- touches the former.
alter table public.profiles add column status_auto boolean not null default false;

-- Manual sets (set_status) always mark status_auto = false, so a later
-- arrival won't silently clobber a status the person chose on purpose.
create or replace function public.set_status(p_emoji text, p_text text, p_minutes int default 240)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_text is not null and length(p_text) > 40 then
    raise exception 'Keep it under 40 characters.';
  end if;
  if p_minutes is null or p_minutes <= 0 or p_minutes > 1440 then
    raise exception 'A status lasts up to 24 hours.';
  end if;

  update public.profiles
  set status_emoji = p_emoji,
      status_text = nullif(trim(p_text), ''),
      status_expires_at = now() + make_interval(mins => p_minutes),
      status_auto = false
  where id = auth.uid();
end;
$$;

create or replace function public.clear_status()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set status_emoji = null, status_text = null, status_expires_at = null, status_auto = false
  where id = auth.uid();
end;
$$;

-- Same "guess from the name" rules as mobile/web's placeIcon() (kept in
-- sync by hand — there's no shared code between SQL and TypeScript here).
create function public.status_for_place(p_name text)
returns table (emoji text, label text)
language sql
immutable
as $$
  select
    case
      when p_name ~* '\mhome\M|\mhouse\M' then '🏠'
      when p_name ~* 'school|college|university' then '📚'
      when p_name ~* '\mwork\M|office' then '💼'
      when p_name ~* 'gym|fitness' then '🏋️'
      when p_name ~* 'hospital|clinic|doctor' then '🏥'
      else '📍'
    end,
    case
      when p_name ~* '\mhome\M|\mhouse\M' then 'Home'
      when p_name ~* 'school|college|university' then 'In class'
      when p_name ~* '\mwork\M|office' then 'At work'
      when p_name ~* 'gym|fitness' then 'At the gym'
      when p_name ~* 'hospital|clinic|doctor' then 'At ' || p_name
      else 'At ' || p_name
    end;
$$;

create function public.apply_auto_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  place_name text;
  st record;
  is_auto boolean;
begin
  select name into place_name from public.places where id = new.place_id;
  if place_name is null then
    return new;
  end if;

  select status_auto into is_auto from public.profiles where id = new.user_id;

  if new.event_type = 'arrived' then
    -- Only ever replaces "no status" or an earlier auto one — never a
    -- status the person picked themselves.
    if coalesce(is_auto, true) then
      select * into st from public.status_for_place(place_name);
      update public.profiles
      set status_emoji = st.emoji,
          status_text = st.label,
          -- Shorter than a manual status's default (4h): places you're
          -- inside long enough to auto-clear on leaving anyway rarely need
          -- the fallback, but a 2h cap keeps a status that never gets a
          -- "left" event (background tracking stalled, phone died) from
          -- lingering all day.
          status_expires_at = now() + interval '2 hours',
          status_auto = true
      where id = new.user_id;
    end if;
  elsif new.event_type = 'left' then
    -- Only clear a status this feature itself set.
    if is_auto then
      update public.profiles
      set status_emoji = null, status_text = null, status_expires_at = null, status_auto = false
      where id = new.user_id;
    end if;
  end if;

  return new;
end;
$$;

create trigger geofence_events_apply_auto_status
  after insert on public.geofence_events
  for each row execute function public.apply_auto_status();
