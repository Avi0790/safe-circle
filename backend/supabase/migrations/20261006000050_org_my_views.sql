-- "Who's looked at me" for a worker: every time an admin or manager opened
-- their live location or pulled their shift track (org_audit, migration
-- ...000048), with who and when. A worker could already read the raw
-- audit rows, but profiles are only readable between circle-mates, so the
-- viewer's name needs this function. Names of the people who run your own
-- organization aren't private from you.
create function public.org_my_views(p_org uuid, p_limit int default 20)
returns table (
  viewer_name text,
  viewer_role text,
  action text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    p_limit := 20;
  end if;

  return query
  select p.full_name, m.role, a.action, a.created_at
  from public.org_audit a
  join public.profiles p on p.id = a.actor_id
  left join public.org_members m on m.org_id = a.org_id and m.user_id = a.actor_id
  where a.org_id = p_org
    and a.target_id = auth.uid()
    and a.actor_id <> auth.uid()
    and a.action like 'viewed%'
  order by a.created_at desc
  limit p_limit;
end;
$$;

revoke all on function public.org_my_views(uuid, int) from public, anon;
grant execute on function public.org_my_views(uuid, int) to authenticated;
