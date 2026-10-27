-- Renaming and deleting an organization. Until now neither was possible: an
-- organization made by mistake (or a duplicate) stayed forever, along with
-- its shifts and audit log.
--
-- Rename: owners and admins.
-- Delete: owners only, and they must type the organization's name, checked
-- here rather than only in the app. Everything the organization held goes:
-- memberships, teams, shifts (current and former workers'), the audit log
-- and the plan. Locations are never the organization's, so they stay with
-- each person. Everyone else who was in it gets a push saying it closed and
-- that nobody there can see them any more. The apps offer the timesheet CSV
-- first, since payroll records are the one thing an owner might need to keep.

create function public.rename_organization(p_org uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  new_name text := trim(coalesce(p_name, ''));
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if coalesce(public.org_role_of(p_org) in ('owner', 'admin'), false) is not true then
    raise exception 'Only an owner or admin can rename the organization.';
  end if;
  if char_length(new_name) < 1 or char_length(new_name) > 80 then
    raise exception 'Give the organization a name of 1 to 80 characters.';
  end if;
  update public.organizations set name = new_name where id = p_org;
end;
$$;

create function public.delete_organization(p_org uuid, p_confirm_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org_name text;
  others uuid[];
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if public.org_role_of(p_org) is distinct from 'owner' then
    raise exception 'Only an owner can delete the organization.';
  end if;

  select name into org_name from public.organizations where id = p_org for update;
  if lower(trim(coalesce(p_confirm_name, ''))) <> lower(org_name) then
    raise exception 'Type the organization''s name exactly to delete it.';
  end if;

  select coalesce(array_agg(user_id), '{}') into others
  from public.org_members
  where org_id = p_org and user_id <> auth.uid();

  -- In this order: the member-cleanup trigger closes open shifts as each
  -- member goes, so the shifts must already be gone, not mid-cascade.
  delete from public.shifts where org_id = p_org;
  delete from public.org_members where org_id = p_org;
  delete from public.organizations where id = p_org; -- teams, audit, plan cascade

  perform public.send_alert_push(
    others,
    org_name || ' closed',
    org_name || ' was deleted by its owner. Nobody there can see you any more; your circles are unchanged.',
    jsonb_build_object('type', 'org_closed')
  );
end;
$$;

revoke all on function public.rename_organization(uuid, text) from public, anon;
revoke all on function public.delete_organization(uuid, text) from public, anon;
grant execute on function public.rename_organization(uuid, text) to authenticated;
grant execute on function public.delete_organization(uuid, text) to authenticated;
