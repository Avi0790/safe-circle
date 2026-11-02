-- Heat, cold, storm and wind warnings on shift. While a worker is clocked in,
-- their phone looks up the weather where they are (Open-Meteo, as the member
-- screen already does) at most every 20 minutes and, when it's risky, tells
-- them on the phone and reports it here (mobile/lib/workWeather.ts). This
-- pushes the people who oversee them, once per shift for each risk and
-- level, so a hot afternoon is one heads-up, not one every 20 minutes.
--
-- Nothing new becomes visible: the people told already see the worker's
-- location on shift, and the weather at it. Off shift, nothing is reported.

create table public.shift_weather_alerts (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  shift_id bigint not null references public.shifts (id) on delete cascade,
  kind text not null check (kind in ('heat', 'cold', 'storm', 'wind')),
  level text not null check (level in ('caution', 'danger')),
  feels_like_f int,
  gust_mph int,
  created_at timestamptz not null default now(),
  unique (shift_id, kind, level)
);
create index shift_weather_alerts_org_idx on public.shift_weather_alerts (org_id, created_at desc);

alter table public.shift_weather_alerts enable row level security;
create policy "shift_weather_alerts_select" on public.shift_weather_alerts
  for select to authenticated using (public.can_see_schedule(org_id, user_id));
-- Written only by report_weather_risk().

create function public.report_weather_risk(
  p_kind text,
  p_level text,
  p_feels_like_f int default null,
  p_gust_mph int default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.shifts;
  who_name text;
  new_id bigint;
  title text;
  body text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_kind not in ('heat', 'cold', 'storm', 'wind') or p_level not in ('caution', 'danger') then
    raise exception 'Unknown weather risk.';
  end if;
  if p_feels_like_f not between -80 and 160 or p_gust_mph not between 0 and 200 then
    raise exception 'Implausible weather.';
  end if;

  select * into s from public.shifts
  where user_id = auth.uid() and clocked_out_at is null
    and clocked_in_at > now() - public.max_shift_length();
  if s.id is null then
    return false; -- off shift: nothing to report, and the phone stops checking
  end if;

  insert into public.shift_weather_alerts (org_id, user_id, shift_id, kind, level, feels_like_f, gust_mph)
  values (s.org_id, auth.uid(), s.id, p_kind, p_level, p_feels_like_f, p_gust_mph)
  on conflict (shift_id, kind, level) do nothing
  returning id into new_id;
  if new_id is null then
    return true; -- already told this shift
  end if;

  select full_name into who_name from public.profiles where id = auth.uid();
  who_name := coalesce(who_name, 'A worker');
  if p_kind = 'heat' then
    title := case p_level when 'danger' then '🥵 Dangerous heat where ' || who_name || ' is working'
                          else '🌡️ Heat where ' || who_name || ' is working' end;
    body := 'Feels like ' || p_feels_like_f || '°F. Make sure they get water, shade and rest breaks.';
  elsif p_kind = 'cold' then
    title := case p_level when 'danger' then '🥶 Dangerous cold where ' || who_name || ' is working'
                          else '❄️ Cold where ' || who_name || ' is working' end;
    body := 'Feels like ' || p_feels_like_f || '°F. Make sure they can warm up indoors.';
  elsif p_kind = 'storm' then
    title := '⛈️ Thunderstorm where ' || who_name || ' is working';
    body := 'Lightning risk. They should get indoors or into a vehicle.';
  else
    title := '💨 Strong wind where ' || who_name || ' is working';
    body := 'Gusts of ' || p_gust_mph || ' mph. Work at height or with loose materials should stop.';
  end if;

  perform public.send_alert_push(
    public.org_overseer_ids(s.org_id, auth.uid()),
    title,
    body,
    jsonb_build_object('type', 'shift_weather', 'orgId', s.org_id, 'userId', auth.uid(), 'kind', p_kind, 'level', p_level)
  );
  return true;
end;
$$;
revoke all on function public.report_weather_risk(text, text, int, int) from public, anon;
grant execute on function public.report_weather_risk(text, text, int, int) to authenticated;

-- Recent weather warnings for the workers the caller oversees (or their own).
create function public.org_weather_alerts(p_org uuid, p_hours int default 24)
returns table (
  id bigint,
  user_id uuid,
  worker_name text,
  kind text,
  level text,
  feels_like_f int,
  gust_mph int,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.user_id, p.full_name, a.kind, a.level, a.feels_like_f, a.gust_mph, a.created_at
  from public.shift_weather_alerts a
  left join public.profiles p on p.id = a.user_id
  where a.org_id = p_org
    and a.created_at > now() - make_interval(hours => least(greatest(coalesce(p_hours, 24), 1), 24 * 14))
    and public.can_see_schedule(a.org_id, a.user_id)
  order by a.created_at desc
  limit 100;
$$;
revoke all on function public.org_weather_alerts(uuid, int) from public, anon;
grant execute on function public.org_weather_alerts(uuid, int) to authenticated;

-- Part of "Download my data" too.
alter function public.export_my_data() rename to export_my_data_through_075;
revoke all on function public.export_my_data_through_075() from public, anon, authenticated;

create function public.export_my_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  return public.export_my_data_through_075() || jsonb_build_object(
    'weather_warnings_on_shift', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'organization', o.name, 'kind', a.kind, 'level', a.level,
        'feels_like_f', a.feels_like_f, 'gust_mph', a.gust_mph, 'at', a.created_at
      ) order by a.created_at desc), '[]'::jsonb)
      from public.shift_weather_alerts a join public.organizations o on o.id = a.org_id
      where a.user_id = auth.uid()
    )
  );
end;
$$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
