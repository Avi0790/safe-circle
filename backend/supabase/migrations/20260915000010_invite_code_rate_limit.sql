-- Security fix: redeem_invite_code() had no rate limiting and codes never
-- expired. The alphabet is 32 chars x 6 = ~1.07B combinations, but with
-- no throttling an attacker holding the (public) anon key could attempt
-- to brute-force a valid code and join a circle they were never invited
-- to. Fixes: codes now expire, and each authenticated user is capped on
-- redemption attempts within a rolling window.

alter table public.circles
  add column invite_code_expires_at timestamptz not null default now() + interval '48 hours';

-- Locked down (no RLS policies at all -> default deny); only touched by
-- the security definer functions below.
create table public.invite_redemption_attempts (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  window_start timestamptz not null default now(),
  attempt_count int not null default 0
);

alter table public.invite_redemption_attempts enable row level security;

create or replace function public.create_circle(circle_name text)
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

  insert into public.circles (name, invite_code_hash, created_by, invite_code_expires_at)
  values (circle_name, encode(digest(plain_code, 'sha256'), 'hex'), auth.uid(), now() + interval '48 hours')
  returning id into new_circle_id;

  insert into public.circle_members (circle_id, user_id)
  values (new_circle_id, auth.uid());

  return query select new_circle_id, plain_code;
end;
$$;

create or replace function public.regenerate_invite_code(target_circle_id uuid)
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
  set invite_code_hash = encode(digest(plain_code, 'sha256'), 'hex'),
      invite_code_expires_at = now() + interval '48 hours'
  where id = target_circle_id;

  return plain_code;
end;
$$;

-- Returns the joined circle's id, or null for an invalid/expired code —
-- deliberately NOT an exception. A raised exception aborts the whole
-- function's transaction, which would also undo the attempt-counter
-- update above it in the same call. Since a wrong code is exactly what a
-- brute-force attempt looks like, raising here would mean brute-forced
-- attempts never actually got counted, defeating the rate limit entirely
-- (caught by testing: 12 guesses against a bogus code left the counter
-- table empty). Callers should treat a null return as "invalid code".
create or replace function public.redeem_invite_code(code text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target_circle_id uuid;
  window_len constant interval := interval '15 minutes';
  max_attempts constant int := 10;
  attempt public.invite_redemption_attempts;
begin
  insert into public.invite_redemption_attempts (user_id, window_start, attempt_count)
  values (auth.uid(), now(), 1)
  on conflict (user_id) do update
    set attempt_count = case
          when invite_redemption_attempts.window_start < now() - window_len then 1
          else invite_redemption_attempts.attempt_count + 1
        end,
        window_start = case
          when invite_redemption_attempts.window_start < now() - window_len then now()
          else invite_redemption_attempts.window_start
        end
  returning * into attempt;

  if attempt.attempt_count > max_attempts then
    raise exception 'Too many invite code attempts. Try again in a few minutes.';
  end if;

  select id into target_circle_id
  from public.circles
  where invite_code_hash = encode(digest(upper(trim(code)), 'sha256'), 'hex')
    and invite_code_expires_at > now();

  if target_circle_id is null then
    return null;
  end if;

  insert into public.circle_members (circle_id, user_id)
  values (target_circle_id, auth.uid())
  on conflict do nothing;

  return target_circle_id;
end;
$$;
