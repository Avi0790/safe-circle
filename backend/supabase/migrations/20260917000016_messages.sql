-- In-circle chat — Life360's most-used feature, and the one thing the
-- proposal never scoped in at all: circles could share location, get
-- geofence/SOS alerts, but had no way to actually talk to each other
-- without leaving the app. Kept deliberately simple and append-only
-- (same philosophy as locations/sos_events): no edit or delete, no
-- read receipts, no typing indicators — just a shared thread per circle.
create table public.messages (
  id bigint generated always as identity primary key,
  circle_id uuid not null references public.circles (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index messages_circle_idx on public.messages (circle_id, created_at desc);

alter table public.messages enable row level security;

create policy "messages_select_members"
  on public.messages for select
  using (public.is_member_of(circle_id));

create policy "messages_insert_member"
  on public.messages for insert
  with check (public.is_member_of(circle_id) and user_id = auth.uid());

alter publication supabase_realtime add table public.messages;
