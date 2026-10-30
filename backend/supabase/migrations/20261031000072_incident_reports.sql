-- Incident and hazard reports for work crews. A worker (or a manager) reports
-- a hazard, a near miss or an injury from the job site: a kind, a note, an
-- optional photo, and their position only if they're clocked in to that
-- organization (the same rule as everything else at work: seen on shift,
-- private off it). Whoever oversees them is pushed at once.
--
-- Who can read a report: the person who filed it; the organization's owners
-- and admins; and a manager who leads a team the reporter is on (the same
-- people who can see that worker on shift). Owners, admins and those managers
-- can mark it resolved. Photos live in a private storage bucket, readable by
-- the same people.

create table public.incident_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('hazard', 'near_miss', 'injury', 'other')),
  note text not null check (char_length(trim(note)) between 1 and 1000),
  latitude double precision,
  longitude double precision,
  photo_path text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check ((latitude is null) = (longitude is null)),
  check ((status = 'resolved') = (resolved_at is not null))
);

create index incident_reports_org_idx on public.incident_reports (org_id, created_at desc);
create index incident_reports_user_idx on public.incident_reports (user_id);

alter table public.incident_reports enable row level security;

-- Owners and admins of the organization, and a manager leading one of the
-- reporter's teams. (org_can_see_worker only covers active workers, so a
-- manager's own report reaches owners and admins only.)
create function public.can_see_incident(p_org uuid, p_reporter uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_reporter = auth.uid()
    or public.is_org_admin(p_org)
    or public.org_can_see_worker(p_org, p_reporter);
$$;
revoke all on function public.can_see_incident(uuid, uuid) from public, anon;
grant execute on function public.can_see_incident(uuid, uuid) to authenticated;

create policy "incident_reports_select"
  on public.incident_reports for select to authenticated
  using (public.can_see_incident(org_id, user_id));
-- No insert/update/delete policies: reports go in through report_incident()
-- and are resolved through resolve_incident(), which check the rules.

-- Who is told about a new report: the reporter's overseers when they're a
-- worker, otherwise the owners and admins.
create function public.incident_audience(p_org uuid, p_reporter uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.org_role_of(p_org, p_reporter) = 'worker' then public.org_overseer_ids(p_org, p_reporter)
    else coalesce((
      select array_agg(user_id) from public.org_members
      where org_id = p_org and status = 'active' and role in ('owner', 'admin') and user_id <> p_reporter
    ), '{}'::uuid[])
  end;
$$;
revoke all on function public.incident_audience(uuid, uuid) from public, anon, authenticated;

create function public.report_incident(
  p_org uuid,
  p_kind text,
  p_note text,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_photo_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  role text;
  on_shift boolean;
  new_id uuid;
  who_name text;
  label text;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  role := public.org_role_of(p_org, uid);
  if role is null then
    raise exception 'You''re not in this organization.';
  end if;
  if p_kind is null or p_kind not in ('hazard', 'near_miss', 'injury', 'other') then
    raise exception 'Choose hazard, near miss, injury or other.';
  end if;
  if p_note is null or char_length(trim(p_note)) = 0 then
    raise exception 'Say what happened.';
  end if;
  if char_length(trim(p_note)) > 1000 then
    raise exception 'Keep it under 1000 characters.';
  end if;
  -- a photo must be one the reporter uploaded for this organization
  if p_photo_path is not null and p_photo_path not like p_org::text || '/' || uid::text || '/%' then
    raise exception 'That photo isn''t yours to attach.';
  end if;

  -- position only while clocked in here: never off shift
  select exists (
    select 1 from public.shifts
    where user_id = uid and org_id = p_org and clocked_out_at is null
  ) into on_shift;

  insert into public.incident_reports (org_id, user_id, kind, note, latitude, longitude, photo_path)
  values (
    p_org, uid, p_kind, trim(p_note),
    case when on_shift and p_latitude is not null and p_longitude is not null then p_latitude end,
    case when on_shift and p_latitude is not null and p_longitude is not null then p_longitude end,
    p_photo_path
  )
  returning id into new_id;

  select full_name into who_name from public.profiles where id = uid;
  label := case p_kind
    when 'hazard' then 'Hazard'
    when 'near_miss' then 'Near miss'
    when 'injury' then 'Injury'
    else 'Incident'
  end;
  perform public.send_alert_push(
    public.incident_audience(p_org, uid),
    '⚠️ ' || label || ' reported by ' || coalesce(who_name, 'a worker'),
    left(trim(p_note), 140),
    jsonb_build_object('type', 'incident', 'incidentId', new_id, 'orgId', p_org)
  );
  return new_id;
end;
$$;
revoke all on function public.report_incident(uuid, text, text, double precision, double precision, text) from public, anon;
grant execute on function public.report_incident(uuid, text, text, double precision, double precision, text) to authenticated;

create function public.resolve_incident(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.incident_reports;
begin
  select * into r from public.incident_reports where id = p_id;
  if r.id is null or not public.can_see_incident(r.org_id, r.user_id) then
    raise exception 'Report not found.';
  end if;
  -- the reporter can see their own report, but resolving is for overseers
  if not (public.is_org_admin(r.org_id) or public.org_can_see_worker(r.org_id, r.user_id)) then
    raise exception 'Only owners, admins and the reporter''s managers can resolve a report.';
  end if;
  update public.incident_reports
  set status = 'resolved', resolved_by = auth.uid(), resolved_at = now()
  where id = p_id and status = 'open';
end;
$$;
revoke all on function public.resolve_incident(uuid) from public, anon;
grant execute on function public.resolve_incident(uuid) to authenticated;

-- The reports you may read in one organization, newest first, with the
-- reporter's name (managers can't read a worker's profile directly; this
-- names only people whose reports they may see).
create function public.org_incidents(p_org uuid, p_status text default null)
returns table (
  id uuid,
  user_id uuid,
  reporter_name text,
  kind text,
  note text,
  latitude double precision,
  longitude double precision,
  photo_path text,
  status text,
  resolved_at timestamptz,
  created_at timestamptz,
  can_resolve boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.user_id, p.full_name, r.kind, r.note, r.latitude, r.longitude, r.photo_path,
         r.status, r.resolved_at, r.created_at,
         public.is_org_admin(r.org_id) or public.org_can_see_worker(r.org_id, r.user_id)
  from public.incident_reports r
  left join public.profiles p on p.id = r.user_id
  where r.org_id = p_org
    and public.can_see_incident(r.org_id, r.user_id)
    and (p_status is null or r.status = p_status)
  order by r.created_at desc
  limit 200;
$$;
revoke all on function public.org_incidents(uuid, text) from public, anon;
grant execute on function public.org_incidents(uuid, text) to authenticated;

-- Photos: a private bucket. You upload into <org>/<you>/..., only for an
-- organization you're in; a photo is readable by whoever can read the report
-- it belongs to (and by you, before the report is sent).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('incident-photos', 'incident-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "incident_photos_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'incident-photos'
    and (storage.foldername(name))[2] = auth.uid()::text
    and exists (
      select 1 from public.org_members m
      where m.org_id::text = (storage.foldername(name))[1]
        and m.user_id = auth.uid() and m.status = 'active'
    )
  );

create policy "incident_photos_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'incident-photos'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or exists (
        select 1 from public.incident_reports r
        where r.photo_path = storage.objects.name
          and public.can_see_incident(r.org_id, r.user_id)
      )
    )
  );

alter publication supabase_realtime add table public.incident_reports;

-- Your incident reports are part of "Download my data".
create or replace function public.export_my_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  return jsonb_build_object(
    'exported_at', now(),
    'note', 'Locations are limited to your newest 5000 points.',
    'profile', (select to_jsonb(p) from public.profiles p where p.id = uid),
    'circles', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'you_created_it', c.created_by = uid, 'joined_at', cm.joined_at
      )), '[]'::jsonb)
      from public.circle_members cm join public.circles c on c.id = cm.circle_id
      where cm.user_id = uid
    ),
    'locations', (
      select coalesce(jsonb_agg(to_jsonb(l) - 'id' - 'user_id' order by l.recorded_at desc), '[]'::jsonb)
      from (select * from public.locations where user_id = uid order by recorded_at desc limit 5000) l
    ),
    'places_you_created', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', name, 'latitude', latitude, 'longitude', longitude, 'radius_meters', radius_meters
      )), '[]'::jsonb)
      from public.places where created_by = uid
    ),
    'messages', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'body', body, 'latitude', latitude, 'longitude', longitude, 'created_at', created_at
      ) order by created_at desc), '[]'::jsonb)
      from public.messages where user_id = uid
    ),
    'sos_events', (select coalesce(jsonb_agg(to_jsonb(s) - 'user_id'), '[]'::jsonb) from public.sos_events s where s.user_id = uid),
    'walks', (select coalesce(jsonb_agg(to_jsonb(w) - 'user_id'), '[]'::jsonb) from public.walks w where w.user_id = uid),
    'safety_timers', (select coalesce(jsonb_agg(to_jsonb(t) - 'user_id'), '[]'::jsonb) from public.safety_timers t where t.user_id = uid),
    'ride_requests', (select coalesce(jsonb_agg(to_jsonb(r) - 'user_id'), '[]'::jsonb) from public.ride_requests r where r.user_id = uid),
    'medical_card', (select to_jsonb(m) - 'user_id' from public.medical_cards m where m.user_id = uid),
    'curfew', (select to_jsonb(cu) - 'user_id' from public.curfews cu where cu.user_id = uid),
    'backup_contacts', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'phone_number', phone_number)), '[]'::jsonb) from public.backup_contacts where user_id = uid),
    'people_you_hide_from', (
      select coalesce(jsonb_agg(p.full_name), '[]'::jsonb)
      from public.hidden_from h join public.profiles p on p.id = h.hidden_from_id where h.owner_id = uid
    ),
    'guest_links', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'created_at', created_at, 'expires_at', expires_at, 'revoked_at', revoked_at, 'view_count', view_count
      )), '[]'::jsonb)
      from public.share_links where user_id = uid
    ),
    'who_viewed_your_history', (
      select coalesce(jsonb_agg(jsonb_build_object('viewer', p.full_name, 'at', v.created_at) order by v.created_at desc), '[]'::jsonb)
      from public.location_views v join public.profiles p on p.id = v.viewer_id where v.viewed_id = uid
    ),
    'organizations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'organization', o.name,
        'role', m.role,
        'status', m.status,
        'joined_at', m.joined_at,
        'consented_at', m.consented_at,
        'consented_to_disclosure_version', m.consent_version,
        'teams', (
          select coalesce(jsonb_agg(jsonb_build_object('team', t.name, 'is_lead', tm.is_lead)), '[]'::jsonb)
          from public.team_members tm join public.teams t on t.id = tm.team_id
          where tm.user_id = uid and t.org_id = m.org_id
        )
      ) order by o.name), '[]'::jsonb)
      from public.org_members m join public.organizations o on o.id = m.org_id
      where m.user_id = uid
    ),
    'work_shifts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'organization', o.name,
        'clocked_in_at', s.clocked_in_at,
        'clocked_out_at', s.clocked_out_at,
        'check_in_every_minutes', s.checkin_minutes,
        'last_check_in_at', s.last_checkin_at
      ) order by s.clocked_in_at desc), '[]'::jsonb)
      from public.shifts s join public.organizations o on o.id = s.org_id
      where s.user_id = uid
    ),
    'who_looked_at_you_at_work', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'organization', o.name, 'viewer', p.full_name, 'action', a.action, 'at', a.created_at
      ) order by a.created_at desc), '[]'::jsonb)
      from public.org_audit a
      join public.organizations o on o.id = a.org_id
      left join public.profiles p on p.id = a.actor_id
      where a.target_id = uid and a.actor_id is distinct from uid
    ),
    'shared_trips', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'circle', c.name, 'destination', t.destination, 'estimated_arrival', t.eta,
        'status', t.status, 'started_at', t.started_at, 'ended_at', t.ended_at
      ) order by t.started_at desc), '[]'::jsonb)
      from public.shared_trips t join public.circles c on c.id = t.circle_id
      where t.user_id = uid
    ),
    'incident_reports', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'organization', o.name, 'kind', r.kind, 'note', r.note,
        'latitude', r.latitude, 'longitude', r.longitude, 'photo', r.photo_path,
        'status', r.status, 'reported_at', r.created_at, 'resolved_at', r.resolved_at
      ) order by r.created_at desc), '[]'::jsonb)
      from public.incident_reports r join public.organizations o on o.id = r.org_id
      where r.user_id = uid
    )
  );
end;
$$;
