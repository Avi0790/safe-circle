-- Meetup pins: drop a temporary "meet here" pin on the map for a festival,
-- a campus meetup, a trailhead — anywhere that isn't worth saving as a
-- permanent place. Circle-wide, pushed to everyone, and cleans itself up.
create table public.map_pins (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  emoji text not null default '📍',
  label text not null,
  latitude double precision not null,
  longitude double precision not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index map_pins_circle_idx on public.map_pins (circle_id);

alter table public.map_pins enable row level security;

create policy "map_pins_select"
  on public.map_pins for select
  using (public.is_member_of(circle_id));

-- No insert/update/delete policy — dropping and removing a pin go through
-- drop_pin()/remove_pin() below, so a client can't backdate expires_at or
-- drop a pin in a circle it isn't in.

alter publication supabase_realtime add table public.map_pins;

create function public.drop_pin(
  p_circle_id uuid,
  p_emoji text,
  p_label text,
  p_latitude double precision,
  p_longitude double precision,
  p_minutes int default 240
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  dropper_name text;
  pin_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_member_of(p_circle_id) then
    raise exception 'Not a member of this circle.';
  end if;
  if p_label is null or length(trim(p_label)) = 0 then
    raise exception 'Give the pin a label.';
  end if;
  if length(p_label) > 40 then
    raise exception 'Keep the label under 40 characters.';
  end if;
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'Invalid location.';
  end if;
  if p_minutes is null or p_minutes < 5 or p_minutes > 1440 then
    raise exception 'Choose between 5 minutes and 24 hours.';
  end if;

  insert into public.map_pins (circle_id, created_by, emoji, label, latitude, longitude, expires_at)
  values (
    p_circle_id, auth.uid(), coalesce(nullif(trim(p_emoji), ''), '📍'), trim(p_label),
    p_latitude, p_longitude, now() + make_interval(mins => p_minutes)
  )
  returning id into pin_id;

  select full_name into dropper_name from public.profiles where id = auth.uid();
  perform public.send_alert_push(
    public.circle_recipients(p_circle_id, auth.uid()),
    coalesce(nullif(trim(p_emoji), ''), '📍') || ' ' || dropper_name || ' dropped a pin',
    trim(p_label),
    jsonb_build_object('type', 'pin', 'pinId', pin_id, 'circleId', p_circle_id)
  );

  return pin_id;
end;
$$;

create function public.remove_pin(p_pin_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.map_pins where id = p_pin_id and created_by = auth.uid();
end;
$$;

revoke all on function public.drop_pin(uuid, text, text, double precision, double precision, int) from public, anon;
revoke all on function public.remove_pin(uuid) from public, anon;
grant execute on function public.drop_pin(uuid, text, text, double precision, double precision, int) to authenticated;
grant execute on function public.remove_pin(uuid) to authenticated;

-- Storage hygiene: delete pins that expired more than a day ago. Not the
-- live filtering itself (clients already query expires_at > now()) — just
-- keeps the table from growing forever with dead rows.
create function public.purge_expired_pins()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  delete from public.map_pins where expires_at < now() - interval '1 day';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.purge_expired_pins() from public, anon, authenticated;

select cron.schedule('purge-expired-pins', '11 4 * * *', 'select public.purge_expired_pins()');
