-- Bug fix (caught in a rolled-back-transaction test of ...000033): a
-- profile with no status at all has status_auto = false (the column's
-- default, not null) — the same value a genuinely manual status has. The
-- original condition `coalesce(is_auto, true)` only guarded against null,
-- so it treated "never set a status" as "has a manual status" and skipped
-- every first arrival. The real question is whether a manual status is
-- *currently active*, not what status_auto happens to be set to.
create or replace function public.apply_auto_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  place_name text;
  st record;
  p record;
  has_active_manual_status boolean;
begin
  select name into place_name from public.places where id = new.place_id;
  if place_name is null then
    return new;
  end if;

  select status_auto, status_expires_at into p from public.profiles where id = new.user_id;
  has_active_manual_status :=
    not coalesce(p.status_auto, false) and p.status_expires_at is not null and p.status_expires_at > now();

  if new.event_type = 'arrived' then
    if not has_active_manual_status then
      select * into st from public.status_for_place(place_name);
      update public.profiles
      set status_emoji = st.emoji,
          status_text = st.label,
          status_expires_at = now() + interval '2 hours',
          status_auto = true
      where id = new.user_id;
    end if;
  elsif new.event_type = 'left' then
    if coalesce(p.status_auto, false) then
      update public.profiles
      set status_emoji = null, status_text = null, status_expires_at = null, status_auto = false
      where id = new.user_id;
    end if;
  end if;

  return new;
end;
$$;
