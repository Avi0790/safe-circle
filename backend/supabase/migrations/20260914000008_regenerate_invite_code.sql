-- create_circle() returns the invite code exactly once. Without a way to
-- get a fresh one later, a circle could only ever be invited to at
-- creation time. Lets any existing member mint a new code (invalidating
-- the old one, same hashing approach as create_circle/redeem_invite_code).
create function public.regenerate_invite_code(target_circle_id uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  plain_code text;
begin
  if not public.is_member_of(target_circle_id) then
    raise exception 'Not a member of this circle';
  end if;

  plain_code := public.generate_invite_code();

  update public.circles
  set invite_code_hash = encode(digest(plain_code, 'sha256'), 'hex')
  where id = target_circle_id;

  return plain_code;
end;
$$;
