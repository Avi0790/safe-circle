-- Roll call: "Is everyone OK?" An owner, admin or manager asks every worker
-- they oversee who is clocked in right now (a storm, a fire alarm, an
-- evacuation). Each gets a push and answers "I'm safe" or "I need help";
-- the dashboard counts them live. "I need help" alerts the people who oversee
-- that worker at once, with where they are. Anyone who hasn't answered after
-- five minutes is asked again, and the person who started it is told how
-- many are still silent. A roll call closes when they close it, or by itself
-- after two hours.
--
-- Only people on shift are asked: off shift, work can't see you, and a roll
-- call is not a way around that. The position goes with an answer only
-- because the worker is on shift, as with everything else in work mode.

create table public.org_roll_calls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  started_by uuid references public.profiles (id) on delete set null,
  note text check (note is null or char_length(note) <= 120),
  created_at timestamptz not null default now(),
  escalated_at timestamptz,
  closed_at timestamptz
);
create index org_roll_calls_org_idx on public.org_roll_calls (org_id, created_at desc);
create index org_roll_calls_open_idx on public.org_roll_calls (created_at) where closed_at is null;

create table public.org_roll_call_members (
  roll_call_id uuid not null references public.org_roll_calls (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  answer text check (answer in ('safe', 'help')),
  answered_at timestamptz,
  latitude double precision,
  longitude double precision,
  primary key (roll_call_id, user_id)
);
create index org_roll_call_members_user_idx on public.org_roll_call_members (user_id);

alter table public.org_roll_calls enable row level security;
alter table public.org_roll_call_members enable row level security;

-- Who may see a roll call: whoever started it, owners and admins, the people
-- asked, and a manager who leads someone who was asked.
create function public.can_see_roll_call(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.org_roll_calls rc
    where rc.id = p_id
      and (
        rc.started_by = auth.uid()
        or public.is_org_admin(rc.org_id)
        or exists (
          select 1 from public.org_roll_call_members m
          where m.roll_call_id = rc.id
            and (m.user_id = auth.uid() or public.org_can_see_worker(rc.org_id, m.user_id))
        )
      )
  );
$$;
revoke all on function public.can_see_roll_call(uuid) from public, anon;
grant execute on function public.can_see_roll_call(uuid) to authenticated;

-- One person's answer: their own, or someone the viewer oversees (or asked).
create function public.can_see_roll_call_answer(p_id uuid, p_worker uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_worker = auth.uid()
    or exists (
      select 1 from public.org_roll_calls rc
      where rc.id = p_id
        and (rc.started_by = auth.uid() or public.is_org_admin(rc.org_id) or public.org_can_see_worker(rc.org_id, p_worker))
    );
$$;
revoke all on function public.can_see_roll_call_answer(uuid, uuid) from public, anon;
grant execute on function public.can_see_roll_call_answer(uuid, uuid) to authenticated;

-- Readable so the dashboard and the phone can follow along through Realtime;
-- every write goes through the functions below.
create policy "org_roll_calls_select" on public.org_roll_calls
  for select to authenticated using (public.can_see_roll_call(id));
create policy "org_roll_call_members_select" on public.org_roll_call_members
  for select to authenticated using (public.can_see_roll_call_answer(roll_call_id, user_id));

create function public.start_roll_call(p_org uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  note text := nullif(trim(coalesce(p_note, '')), '');
  asked uuid[];
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if coalesce(public.org_role_of(p_org) in ('owner', 'admin', 'manager'), false) is not true then
    raise exception 'Only owners, admins and managers can start a roll call.';
  end if;
  if note is not null and char_length(note) > 120 then
    raise exception 'Keep the note under 120 characters.';
  end if;
  if exists (
    select 1 from public.org_roll_calls
    where org_id = p_org and started_by = auth.uid() and closed_at is null
  ) then
    raise exception 'You already have a roll call open. Close it first.';
  end if;

  -- everyone on shift here that this person oversees
  select coalesce(array_agg(distinct s.user_id), '{}'::uuid[]) into asked
  from public.shifts s
  where s.org_id = p_org and s.clocked_out_at is null
    and s.clocked_in_at > now() - public.max_shift_length()
    and public.org_can_see_worker(p_org, s.user_id);
  if cardinality(asked) = 0 then
    raise exception 'Nobody you oversee is on shift right now.';
  end if;

  insert into public.org_roll_calls (org_id, started_by, note)
  values (p_org, auth.uid(), note)
  returning id into new_id;
  insert into public.org_roll_call_members (roll_call_id, user_id)
  select new_id, unnest(asked);

  perform public.send_alert_push(
    asked,
    '📣 Roll call: are you safe?',
    'Open Safe Circle and tap "I''m safe" or "I need help".',
    jsonb_build_object('type', 'roll_call', 'rollCallId', new_id, 'orgId', p_org)
  );
  return new_id;
end;
$$;
revoke all on function public.start_roll_call(uuid, text) from public, anon;
grant execute on function public.start_roll_call(uuid, text) to authenticated;

create function public.answer_roll_call(
  p_id uuid,
  p_answer text,
  p_latitude double precision default null,
  p_longitude double precision default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rc public.org_roll_calls;
  who_name text;
  prior text;
begin
  if p_answer not in ('safe', 'help') then
    raise exception 'Answer safe or help.';
  end if;
  select * into rc from public.org_roll_calls where id = p_id;
  select answer into prior from public.org_roll_call_members where roll_call_id = p_id and user_id = auth.uid();
  if rc.id is null or not found then
    raise exception 'Roll call not found.';
  end if;
  if rc.closed_at is not null then
    raise exception 'That roll call is closed.';
  end if;
  if (p_latitude is null) <> (p_longitude is null)
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'Invalid position.';
  end if;

  -- a later answer replaces an earlier one ("safe" after "help" too)
  update public.org_roll_call_members
  set answer = p_answer, answered_at = now(),
      latitude = coalesce(p_latitude, latitude), longitude = coalesce(p_longitude, longitude)
  where roll_call_id = p_id and user_id = auth.uid();

  if p_answer = 'help' and prior is distinct from 'help' then
    select full_name into who_name from public.profiles where id = auth.uid();
    perform public.send_alert_push(
      array(select distinct unnest(public.org_overseer_ids(rc.org_id, auth.uid()) || array[rc.started_by]) except select auth.uid()),
      '🆘 ' || coalesce(who_name, 'A worker') || ' needs help (roll call)',
      'Open Safe Circle to see where they are.',
      jsonb_build_object('type', 'roll_call_help', 'rollCallId', p_id, 'orgId', rc.org_id, 'userId', auth.uid())
    );
  end if;
end;
$$;
revoke all on function public.answer_roll_call(uuid, text, double precision, double precision) from public, anon;
grant execute on function public.answer_roll_call(uuid, text, double precision, double precision) to authenticated;

create function public.close_roll_call(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rc public.org_roll_calls;
begin
  select * into rc from public.org_roll_calls where id = p_id;
  if rc.id is null or not (rc.started_by = auth.uid() or public.is_org_admin(rc.org_id)) then
    raise exception 'Only the person who started it, or an owner or admin, can close it.';
  end if;
  update public.org_roll_calls set closed_at = coalesce(closed_at, now()) where id = p_id;
end;
$$;
revoke all on function public.close_roll_call(uuid) from public, anon;
grant execute on function public.close_roll_call(uuid) to authenticated;

-- A roll call with its answers, for whoever may see it. A position shows only
-- for people the viewer oversees (or their own).
create function public.roll_call_status(p_id uuid)
returns table (
  user_id uuid,
  full_name text,
  answer text,
  answered_at timestamptz,
  latitude double precision,
  longitude double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, p.full_name, m.answer, m.answered_at,
         case when m.user_id = auth.uid() or public.org_can_see_worker(rc.org_id, m.user_id) or public.is_org_admin(rc.org_id) then m.latitude end,
         case when m.user_id = auth.uid() or public.org_can_see_worker(rc.org_id, m.user_id) or public.is_org_admin(rc.org_id) then m.longitude end
  from public.org_roll_call_members m
  join public.org_roll_calls rc on rc.id = m.roll_call_id
  left join public.profiles p on p.id = m.user_id
  where m.roll_call_id = p_id
    and public.can_see_roll_call_answer(p_id, m.user_id)
  order by (m.answer = 'help') desc nulls last, m.answer nulls first, p.full_name;
$$;
revoke all on function public.roll_call_status(uuid) from public, anon;
grant execute on function public.roll_call_status(uuid) to authenticated;

-- Recent roll calls in an organization with their tallies (overseers), or the
-- ones you were asked in (workers).
create function public.org_roll_calls_list(p_org uuid, p_limit int default 20)
returns table (
  id uuid,
  started_by_name text,
  note text,
  created_at timestamptz,
  closed_at timestamptz,
  asked int,
  safe int,
  help int,
  my_answer text,
  asked_me boolean,
  can_close boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select rc.id, p.full_name, rc.note, rc.created_at, rc.closed_at,
         (select count(*) from public.org_roll_call_members m where m.roll_call_id = rc.id and public.can_see_roll_call_answer(rc.id, m.user_id))::int,
         (select count(*) from public.org_roll_call_members m where m.roll_call_id = rc.id and m.answer = 'safe' and public.can_see_roll_call_answer(rc.id, m.user_id))::int,
         (select count(*) from public.org_roll_call_members m where m.roll_call_id = rc.id and m.answer = 'help' and public.can_see_roll_call_answer(rc.id, m.user_id))::int,
         (select m.answer from public.org_roll_call_members m where m.roll_call_id = rc.id and m.user_id = auth.uid()),
         exists (select 1 from public.org_roll_call_members m where m.roll_call_id = rc.id and m.user_id = auth.uid()),
         rc.closed_at is null and (rc.started_by = auth.uid() or public.is_org_admin(rc.org_id))
  from public.org_roll_calls rc
  left join public.profiles p on p.id = rc.started_by
  where rc.org_id = p_org and public.can_see_roll_call(rc.id)
  order by rc.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;
revoke all on function public.org_roll_calls_list(uuid, int) from public, anon;
grant execute on function public.org_roll_calls_list(uuid, int) to authenticated;

-- Every minute: ask the silent ones again after five minutes and tell the
-- person who started it how many are left; close anything two hours old.
create function public.escalate_roll_calls()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  rc record;
  silent uuid[];
  n int := 0;
begin
  update public.org_roll_calls set closed_at = now()
  where closed_at is null and created_at < now() - interval '2 hours';

  for rc in
    select * from public.org_roll_calls
    where closed_at is null and escalated_at is null and created_at < now() - interval '5 minutes'
    for update skip locked
  loop
    select coalesce(array_agg(user_id), '{}'::uuid[]) into silent
    from public.org_roll_call_members where roll_call_id = rc.id and answer is null;
    if cardinality(silent) > 0 then
      perform public.send_alert_push(
        silent,
        '📣 Roll call: please answer',
        'Open Safe Circle and tap "I''m safe" or "I need help".',
        jsonb_build_object('type', 'roll_call', 'rollCallId', rc.id, 'orgId', rc.org_id)
      );
      perform public.send_alert_push(
        array(select distinct unnest(array[rc.started_by] || coalesce((
          select array_agg(o) from unnest(silent) w, unnest(public.org_overseer_ids(rc.org_id, w)) o
        ), '{}'::uuid[])) except select null::uuid),
        case when cardinality(silent) = 1 then '⏱️ 1 person hasn''t answered the roll call'
             else '⏱️ ' || cardinality(silent) || ' people haven''t answered the roll call' end,
        'Open Safe Circle to see who.',
        jsonb_build_object('type', 'roll_call_late', 'rollCallId', rc.id, 'orgId', rc.org_id)
      );
    end if;
    update public.org_roll_calls set escalated_at = now() where id = rc.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.escalate_roll_calls() from public, anon, authenticated;

select cron.schedule('escalate-roll-calls', '* * * * *', 'select public.escalate_roll_calls()');

alter table public.org_roll_calls replica identity full;
alter table public.org_roll_call_members replica identity full;
alter publication supabase_realtime add table public.org_roll_calls;
alter publication supabase_realtime add table public.org_roll_call_members;

-- Your roll-call answers and your planned shifts (migration ...000074) are
-- part of "Download my data": the export so far, plus those two.
alter function public.export_my_data() rename to export_my_data_through_074;
revoke all on function public.export_my_data_through_074() from public, anon, authenticated;

create function public.export_my_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  return public.export_my_data_through_074() || jsonb_build_object(
    'planned_shifts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'organization', o.name, 'starts_at', s.starts_at, 'ends_at', s.ends_at, 'note', s.note
      ) order by s.starts_at desc), '[]'::jsonb)
      from public.scheduled_shifts s join public.organizations o on o.id = s.org_id
      where s.user_id = uid
    ),
    'roll_call_answers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'organization', o.name, 'asked_at', rc.created_at, 'answer', m.answer, 'answered_at', m.answered_at,
        'latitude', m.latitude, 'longitude', m.longitude
      ) order by rc.created_at desc), '[]'::jsonb)
      from public.org_roll_call_members m
      join public.org_roll_calls rc on rc.id = m.roll_call_id
      join public.organizations o on o.id = rc.org_id
      where m.user_id = uid
    )
  );
end;
$$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
