-- Text for help: a fallback that works when push doesn't. Every alert
-- feature so far (SOS, walk, curfew, nearby...) depends on this phone and
-- Supabase both having internet — a dead data connection or an outage
-- takes all of it down at once. SMS can still get through in places data
-- can't (weak signal, a data cap, flight mode with cellular back on), so
-- this is a break-glass alternative: compose a text with your location to
-- your circle and/or personal backup contacts, entirely on-device. Not
-- automatic — expo-sms opens the native composer and the person still has
-- to tap send, same as "Call 911" already does for phone calls.
--
-- profiles.phone_number is optional and only used for this — it isn't
-- displayed anywhere else. It rides on profiles' existing RLS
-- (profiles_select_self_or_circlemate / profiles_update_self from
-- migration ...000004), so no new policy is needed for it.
alter table public.profiles add column phone_number text;

-- Backup contacts: people outside any circle (a neighbor, a grandparent,
-- a family doctor) who should be texted in an emergency but shouldn't see
-- your location the way a circle-mate does. Deliberately a plain table
-- with direct owner-only policies rather than security-definer RPCs, like
-- everything else so far — there's no cross-user visibility to broker,
-- so there's nothing for a function to guard that RLS doesn't already.
create table public.backup_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null,
  phone_number text not null,
  created_at timestamptz not null default now()
);

create index backup_contacts_user_idx on public.backup_contacts (user_id);

alter table public.backup_contacts enable row level security;

create policy "backup_contacts_all_owner"
  on public.backup_contacts for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
