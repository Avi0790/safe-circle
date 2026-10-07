-- "Download my data" now includes work: the organizations you belong to (role,
-- teams, which disclosure you accepted and when), your shifts and check-ins,
-- and the log of who at work looked at your location. Everything else is
-- unchanged from migration ...000045. Reads the check-in columns added in
-- migration ...000053.
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
    )
  );
end;
$$;
