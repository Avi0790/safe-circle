-- Three things a real app needs and this one lacked:
--   1. transfer a circle to someone else (creators couldn't leave their own
--      circle without orphaning it),
--   2. download everything the app holds about you,
--   3. delete your account.
-- They belong together: deleting a circle's creator would otherwise cascade
-- and delete the circle for everyone still in it, so account deletion hands
-- shared circles to another member first.

create function public.transfer_circle_ownership(p_circle_id uuid, p_new_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  circle_name text;
  old_name text;
begin
  if not public.is_circle_creator(p_circle_id) then
    raise exception 'Only the circle''s creator can transfer it.';
  end if;
  if p_new_owner = auth.uid() then
    raise exception 'You already own this circle.';
  end if;
  if not exists (
    select 1 from public.circle_members where circle_id = p_circle_id and user_id = p_new_owner
  ) then
    raise exception 'The new owner must already be a member of the circle.';
  end if;

  update public.circles set created_by = p_new_owner where id = p_circle_id
  returning name into circle_name;

  select full_name into old_name from public.profiles where id = auth.uid();
  perform public.send_alert_push(
    array[p_new_owner],
    '👑 You''re now the owner of ' || circle_name,
    old_name || ' made you the creator. You can rename it, remove members and manage join approvals.',
    jsonb_build_object('type', 'ownership', 'circleId', p_circle_id)
  );
end;
$$;

-- Everything the app holds about the caller, as one JSON document. Locations
-- are capped at the newest 5,000 so the file stays small enough to share from
-- a phone; the cap is stated in the output.
create function public.export_my_data()
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
    )
  );
end;
$$;

-- Permanently deletes the caller's account and everything hanging off it.
-- Two things would otherwise go wrong, both found by reading the foreign
-- keys before writing this:
--   * circles.created_by cascades — deleting a creator would delete the whole
--     circle for everyone else. Circles that still have other members are
--     handed to the longest-standing one first; only circles with no one else
--     in them are deleted with the account.
--   * sos_events.resolved_by has no ON DELETE action — anyone who had ever
--     resolved someone else's SOS would have been unable to delete their
--     account. Those references are cleared (the SOS itself is kept).
create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  c record;
  heir uuid;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  for c in select id, name from public.circles where created_by = uid loop
    select user_id into heir
    from public.circle_members
    where circle_id = c.id and user_id <> uid
    order by joined_at
    limit 1;

    if heir is not null then
      update public.circles set created_by = heir where id = c.id;
      perform public.send_alert_push(
        array[heir],
        '👑 You''re now the owner of ' || c.name,
        'The previous owner deleted their account, so the circle is yours.',
        jsonb_build_object('type', 'ownership', 'circleId', c.id)
      );
    end if;
  end loop;

  update public.sos_events set resolved_by = null where resolved_by = uid;

  -- profiles (and everything referencing it) go via the auth.users cascade.
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.transfer_circle_ownership(uuid, uuid) from public, anon;
revoke all on function public.export_my_data() from public, anon;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.transfer_circle_ownership(uuid, uuid) to authenticated;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.delete_my_account() to authenticated;
