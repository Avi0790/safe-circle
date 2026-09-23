-- Medical card: blood type, allergies, conditions, medications and a
-- free-text note — but readable by circle-mates ONLY while you have an
-- active SOS. That's the point: the information a first responder or a
-- worried family member needs at the exact moment it matters, without
-- leaving it permanently visible to everyone in your circles the way an
-- ordinary profile field would be. Enforced by RLS, not by the app hiding a
-- section.
create table public.medical_cards (
  user_id uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  blood_type text check (blood_type is null or length(blood_type) <= 10),
  allergies text check (allergies is null or length(allergies) <= 300),
  conditions text check (conditions is null or length(conditions) <= 300),
  medications text check (medications is null or length(medications) <= 300),
  notes text check (notes is null or length(notes) <= 500),
  updated_at timestamptz not null default now()
);

alter table public.medical_cards enable row level security;

-- security definer so the check works from inside a policy on another
-- table without depending on the viewer's own RLS on sos_events (same
-- reason shares_circle_with() and is_hidden_by() exist).
create function public.has_active_sos(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.sos_events
    where user_id = p_user_id
      and resolved_at is null
      and created_at > now() - interval '12 hours'
  );
$$;

revoke all on function public.has_active_sos(uuid) from public, anon;
grant execute on function public.has_active_sos(uuid) to authenticated;

-- You always have full control of your own card...
create policy "medical_cards_owner_all"
  on public.medical_cards for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ...circle-mates can read it only during your active SOS, and never
-- write it.
create policy "medical_cards_select_during_sos"
  on public.medical_cards for select
  using (public.shares_circle_with(user_id) and public.has_active_sos(user_id));
