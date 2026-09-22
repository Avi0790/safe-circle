-- Bug fix (caught in a rolled-back-transaction test of ...000035): hiding
-- someone did nothing. The `locations` policy's inline
-- `not exists (select 1 from hidden_from ...)` subquery runs as the
-- *viewer*, and hidden_from's own RLS (`hidden_from_select_owner`) only
-- lets the owner read their own rows — so as the hidden viewer, that
-- subquery could never see the row that hides them, and always evaluated
-- to "not hidden." The same class of problem shares_circle_with() and
-- is_member_of() already solve for circle_members: wrap the check in its
-- own security-definer function so it runs as the table owner and isn't
-- subject to hidden_from's RLS.
create function public.is_hidden_by(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.hidden_from
    where owner_id = p_owner_id and hidden_from_id = auth.uid()
  );
$$;

revoke all on function public.is_hidden_by(uuid) from public, anon;
grant execute on function public.is_hidden_by(uuid) to authenticated;

drop policy "locations_select_self_or_circlemate" on public.locations;
create policy "locations_select_self_or_circlemate"
  on public.locations for select
  using (
    user_id = auth.uid()
    or (
      public.shares_circle_with(user_id)
      and public.is_sharing(user_id)
      and not public.is_hidden_by(user_id)
    )
  );
