-- Helper: does the caller share ANY circle with other_user_id?
-- security definer + a narrow boolean return avoids exposing circle_members
-- rows the caller isn't otherwise allowed to see, and sidesteps RLS
-- self-reference recursion on circle_members.
create function public.shares_circle_with(other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.circle_members me
    join public.circle_members them on them.circle_id = me.circle_id
    where me.user_id = auth.uid()
      and them.user_id = other_user_id
  );
$$;

-- Helper: is the caller a member of a specific circle?
create function public.is_member_of(target_circle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.circle_members
    where circle_id = target_circle_id and user_id = auth.uid()
  );
$$;

alter table public.profiles enable row level security;
alter table public.circles enable row level security;
alter table public.circle_members enable row level security;
alter table public.locations enable row level security;

-- profiles: see yourself, or anyone you share a circle with. Update only yourself.
-- No insert/delete policy — profiles are created by the on_auth_user_created
-- trigger (security definer) and removed via the auth.users cascade.
create policy "profiles_select_self_or_circlemate"
  on public.profiles for select
  using (id = auth.uid() or public.shares_circle_with(id));

create policy "profiles_update_self"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- circles: only members can see a circle. Only the creator can rename/delete.
-- Direct insert is allowed (created_by must be yourself) but the app should
-- prefer the create_circle() RPC, which also enrolls the creator atomically.
create policy "circles_select_members"
  on public.circles for select
  using (public.is_member_of(id));

create policy "circles_insert_self"
  on public.circles for insert
  with check (created_by = auth.uid());

create policy "circles_update_creator"
  on public.circles for update
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

create policy "circles_delete_creator"
  on public.circles for delete
  using (created_by = auth.uid());

-- circle_members: members can see the roster of their own circles.
-- No insert policy: joining only happens through create_circle() /
-- redeem_invite_code(), both security definer, so nobody can add themselves
-- (or anyone else) to a circle by guessing an id. Leaving a circle is a
-- normal delete of your own row.
create policy "circle_members_select_own_circles"
  on public.circle_members for select
  using (user_id = auth.uid() or public.is_member_of(circle_id));

create policy "circle_members_delete_self"
  on public.circle_members for delete
  using (user_id = auth.uid());

-- locations: append-only. You can always write your own position; you can
-- read a position only if you share a circle with that person. No update or
-- delete policy — history is immutable, and "pause sharing" simply means the
-- device stops inserting new rows.
create policy "locations_select_self_or_circlemate"
  on public.locations for select
  using (user_id = auth.uid() or public.shares_circle_with(user_id));

create policy "locations_insert_self"
  on public.locations for insert
  with check (user_id = auth.uid());
