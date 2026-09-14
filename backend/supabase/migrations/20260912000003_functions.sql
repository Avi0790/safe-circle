-- Auto-create a profile row whenever someone signs up via Supabase Auth.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', 'New user'));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Random 6-character invite code. Uppercase letters + digits, excluding
-- easily-confused characters (0/O, 1/I/L).
create function public.generate_invite_code()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text := '';
  i int;
begin
  for i in 1..6 loop
    code := code || substr(alphabet, floor(random() * length(alphabet) + 1)::int, 1);
  end loop;
  return code;
end;
$$;

-- Creates a circle, hashes its invite code, and adds the caller as the first
-- member, all in one transaction. Returns the plaintext code exactly once —
-- it is never readable again after this call.
create function public.create_circle(circle_name text)
returns table (circle_id uuid, invite_code text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  new_circle_id uuid;
  plain_code text;
begin
  plain_code := public.generate_invite_code();

  insert into public.circles (name, invite_code_hash, created_by)
  values (circle_name, encode(digest(plain_code, 'sha256'), 'hex'), auth.uid())
  returning id into new_circle_id;

  insert into public.circle_members (circle_id, user_id)
  values (new_circle_id, auth.uid());

  return query select new_circle_id, plain_code;
end;
$$;

-- Looks a circle up by invite code (hashed server-side, never compared in
-- plaintext) and joins the caller to it. security definer is required
-- because a user can't SELECT a circles row they don't belong to yet.
create function public.redeem_invite_code(code text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target_circle_id uuid;
begin
  select id into target_circle_id
  from public.circles
  where invite_code_hash = encode(digest(upper(trim(code)), 'sha256'), 'hex');

  if target_circle_id is null then
    raise exception 'Invalid invite code';
  end if;

  insert into public.circle_members (circle_id, user_id)
  values (target_circle_id, auth.uid())
  on conflict do nothing;

  return target_circle_id;
end;
$$;
