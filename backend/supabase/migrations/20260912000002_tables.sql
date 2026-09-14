-- Core schema: profiles, circles, circle_members, locations.
-- One row per profile, mirrors auth.users 1:1.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- A private group. The plaintext invite code is never stored, only its hash.
create table public.circles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code_hash text not null unique,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Join table: who belongs to which circle.
create table public.circle_members (
  circle_id uuid not null references public.circles (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (circle_id, user_id)
);

-- Append-only location pings. One small row per update, per the proposal's
-- "writes are cheap" design (page 4) — the device throttles to ~60s / 50m.
create table public.locations (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  accuracy double precision,
  battery_level real,
  recorded_at timestamptz not null default now()
);

create index locations_user_recorded_idx on public.locations (user_id, recorded_at desc);
create index circle_members_user_idx on public.circle_members (user_id);
create index circle_members_circle_idx on public.circle_members (circle_id);

-- Convenience view for the live map: latest ping per user.
-- security_invoker means RLS is evaluated as the querying user, not the view owner.
create view public.latest_locations
with (security_invoker = true) as
select distinct on (user_id)
  id, user_id, latitude, longitude, accuracy, battery_level, recorded_at
from public.locations
order by user_id, recorded_at desc;
