-- Report an incident while driving (like Apple Maps): a crash, a hazard, a
-- speed check or a closed road, at the spot you are. One tap, no typing.
--
-- A report is shown to the people who can already see where you are, because
-- it says where you were: your circle-mates, minus anyone you've hidden from
-- (Ghost mode), and nobody once your sharing window has ended. They see it on
-- their Directions map and hear about it if their route runs past it. No push
-- notification: a road report is only useful to someone driving there.
--
-- Reports fade out by themselves (1 hour; 3 for a closed road) and are deleted
-- a day later, so this never becomes a log of where someone drove.
create table public.road_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('crash', 'hazard', 'speed_check', 'closure')),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index road_reports_reporter_idx on public.road_reports (reporter_id, created_at desc);
create index road_reports_expires_idx on public.road_reports (expires_at);

alter table public.road_reports enable row level security;

-- Same rule as seeing someone's location, and only while the report is live.
-- No write policies: the functions below are the only way in.
create policy "road_reports_select"
  on public.road_reports for select
  using (
    expires_at > now()
    and (
      reporter_id = auth.uid()
      or (
        public.shares_circle_with(reporter_id)
        and public.is_sharing(reporter_id)
        and not public.is_hidden_by(reporter_id)
      )
    )
  );

alter publication supabase_realtime add table public.road_reports;

create function public.report_road_incident(p_kind text, p_latitude double precision, p_longitude double precision)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing uuid;
  recent int;
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_kind is null or p_kind not in ('crash', 'hazard', 'speed_check', 'closure') then
    raise exception 'Choose crash, hazard, speed check or road closed.';
  end if;
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'Invalid location.';
  end if;

  -- Tapping twice for the same thing (easy in a moving car) refreshes the
  -- first report instead of stacking a second one on top of it.
  select id into existing
  from public.road_reports
  where reporter_id = auth.uid() and kind = p_kind and expires_at > now()
    and created_at > now() - interval '10 minutes'
    and public.haversine_meters(latitude, longitude, p_latitude, p_longitude) < 200
  limit 1;
  if existing is not null then
    update public.road_reports
    set expires_at = now() + case when p_kind = 'closure' then interval '3 hours' else interval '1 hour' end
    where id = existing;
    return existing;
  end if;

  -- At most 5 reports in 10 minutes per person.
  select count(*) into recent
  from public.road_reports
  where reporter_id = auth.uid() and created_at > now() - interval '10 minutes';
  if recent >= 5 then
    raise exception 'That''s a lot of reports in a short time. Try again in a few minutes.';
  end if;

  insert into public.road_reports (reporter_id, kind, latitude, longitude, expires_at)
  values (
    auth.uid(), p_kind, p_latitude, p_longitude,
    now() + case when p_kind = 'closure' then interval '3 hours' else interval '1 hour' end
  )
  returning id into new_id;
  return new_id;
end;
$$;

-- Take back your own report (it was a mistake, or it has cleared).
create function public.clear_road_report(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.road_reports where id = p_id and reporter_id = auth.uid();
$$;

create function public.purge_road_reports()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  delete from public.road_reports where expires_at < now() - interval '1 day';
  get diagnostics n = row_count;
  return n;
end;
$$;

select cron.schedule('purge-road-reports', '23 4 * * *', 'select public.purge_road_reports()');

-- New functions get Supabase's default grants (anon and authenticated
-- included), so set them explicitly.
revoke all on function public.report_road_incident(text, double precision, double precision) from public, anon;
revoke all on function public.clear_road_report(uuid) from public, anon;
revoke all on function public.purge_road_reports() from public, anon, authenticated;
grant execute on function public.report_road_incident(text, double precision, double precision) to authenticated;
grant execute on function public.clear_road_report(uuid) to authenticated;
