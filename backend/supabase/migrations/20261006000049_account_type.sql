-- Account type, chosen at signup: individual, family or industry. It decides
-- which onboarding someone sees first (a circle, an organization, or neither)
-- — a routing preference, not a security boundary. Access to anyone's
-- location is still decided only by the circle/organization rules, so a
-- family account can still join an organization with a code and vice versa.
--
-- Defaults to 'family' so every existing account keeps exactly the
-- create-or-join-a-circle experience it already has.
alter table public.profiles
  add column account_type text not null default 'family'
  check (account_type in ('individual', 'family', 'industry'));

-- Reads the choice from the signup metadata the app sends alongside the
-- name. Anything missing or unrecognised falls back to 'family' rather than
-- failing the signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  chosen text := new.raw_user_meta_data ->> 'account_type';
begin
  insert into public.profiles (id, full_name, account_type)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', 'New user'),
    case when chosen in ('individual', 'family', 'industry') then chosen else 'family' end
  );
  return new;
end;
$$;
