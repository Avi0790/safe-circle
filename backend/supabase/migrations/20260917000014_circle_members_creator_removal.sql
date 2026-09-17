-- The only way to leave circle_members was circle_members_delete_self
-- (...000004_rls.sql) — a member removing themselves. There was no way
-- for a circle's creator to remove someone else (an ex-partner, someone
-- who shouldn't be in the family circle anymore), short of deleting the
-- whole circle and starting over. RLS policies for the same command are
-- OR'd together, so this adds a second delete path without touching the
-- existing self-leave one.
--
-- user_id <> auth.uid() deliberately excludes the creator removing their
-- own row through this path — they already have Leave (self-delete) and
-- Delete-the-whole-circle in the app; routing creator self-removal through
-- circle_members_delete_self instead avoids the orphaned-circle failure
-- mode circles_delete_creator's docstring (mobile Settings) already
-- guards against (a creator with no membership row can no longer see the
-- circle to manage it).
create policy "circle_members_delete_by_creator"
  on public.circle_members for delete
  using (
    user_id <> auth.uid()
    and exists (
      select 1 from public.circles
      where circles.id = circle_members.circle_id
        and circles.created_by = auth.uid()
    )
  );
