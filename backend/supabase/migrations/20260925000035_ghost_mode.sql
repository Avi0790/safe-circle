-- Ghost mode: hide your location from one specific circle-mate while
-- everyone else in the circle still sees you normally. Life360 has no
-- per-person visibility control — it's circle-wide or nothing. Deliberately
-- symmetric with "stopped sharing": the hidden person's dot just isn't
-- there, same as if temporary sharing had ended, so hiding from someone
-- doesn't announce itself any louder than an ordinary sharing gap would.
create table public.hidden_from (
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  hidden_from_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, hidden_from_id),
  check (owner_id <> hidden_from_id)
);

alter table public.hidden_from enable row level security;

-- Only the owner can read their own hide-list — not the hidden person, and
-- not other circle-mates. Someone noticing a dot has disappeared has no way
-- to confirm from this table whether that's ghost mode or ordinary sharing
-- being off; the RLS on `locations` below is where the actual hiding
-- happens either way. No write policies — only the two functions below
-- change it.
create policy "hidden_from_select_owner"
  on public.hidden_from for select
  using (owner_id = auth.uid());

create function public.hide_from(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Cannot hide from yourself.';
  end if;
  if not public.shares_circle_with(p_user_id) then
    raise exception 'Not in a shared circle.';
  end if;

  insert into public.hidden_from (owner_id, hidden_from_id)
  values (auth.uid(), p_user_id)
  on conflict (owner_id, hidden_from_id) do nothing;
end;
$$;

create function public.unhide_from(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.hidden_from where owner_id = auth.uid() and hidden_from_id = p_user_id;
end;
$$;

revoke all on function public.hide_from(uuid) from public, anon;
revoke all on function public.unhide_from(uuid) from public, anon;
grant execute on function public.hide_from(uuid) to authenticated;
grant execute on function public.unhide_from(uuid) to authenticated;

-- The actual hiding: extends the temporary-sharing check (migration
-- ...000025) with one more condition. A hidden viewer still passes
-- shares_circle_with and is_sharing — their own map and every other
-- member's row are completely unaffected; only this one (owner, viewer)
-- pair's rows disappear.
drop policy "locations_select_self_or_circlemate" on public.locations;
create policy "locations_select_self_or_circlemate"
  on public.locations for select
  using (
    user_id = auth.uid()
    or (
      public.shares_circle_with(user_id)
      and public.is_sharing(user_id)
      and not exists (
        select 1 from public.hidden_from h
        where h.owner_id = user_id and h.hidden_from_id = auth.uid()
      )
    )
  );
