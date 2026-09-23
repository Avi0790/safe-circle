-- Join approval: a circle can require its creator to approve each new
-- member. Today anyone holding a valid invite code joins instantly — the
-- code is rate-limited and expires in 48h (migration ...000010), but a code
-- that leaks into the wrong chat still adds a stranger to a group that can
-- see everyone's live location. With approval on, a leaked code only ever
-- creates a request the creator can deny. Off by default, so every existing
-- circle behaves exactly as before.
alter table public.circles add column require_approval boolean not null default false;

create table public.join_requests (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null
);

create unique index join_requests_one_pending
  on public.join_requests (circle_id, user_id) where status = 'pending';

alter table public.join_requests enable row level security;

-- The requester sees their own; the circle's creator sees requests to it.
-- security definer helper so the policy doesn't depend on RLS of `circles`
-- (whose select policy only shows circles you're already a member of).
create function public.is_circle_creator(target_circle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.circles where id = target_circle_id and created_by = auth.uid()
  );
$$;

create policy "join_requests_select"
  on public.join_requests for select
  using (user_id = auth.uid() or public.is_circle_creator(circle_id));

-- No write policies — only the functions below.

create function public.set_circle_approval(p_circle_id uuid, p_required boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_circle_creator(p_circle_id) then
    raise exception 'Only the circle''s creator can change this.';
  end if;
  update public.circles set require_approval = coalesce(p_required, false) where id = p_circle_id;
end;
$$;

-- The old function joins instantly. Make it refuse circles that require
-- approval (null = "invalid code", same as today for an unknown code)
-- instead of letting an old client bypass the approval step.
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
    and invite_code_expires_at > now()
    and not require_approval;

  if target_circle_id is null then
    return null;
  end if;

  insert into public.circle_members (circle_id, user_id)
  values (target_circle_id, auth.uid())
  on conflict do nothing;

  return target_circle_id;
end;
$$;

-- The approval-aware join. Same attempt counter as redeem_invite_code (and
-- the same rule: return, don't raise, on a bad code, so the attempt still
-- counts). Returns {status: joined | pending | invalid, circle_id}.
create function public.join_with_code(code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c public.circles;
  window_len constant interval := interval '15 minutes';
  max_attempts constant int := 10;
  attempt public.invite_redemption_attempts;
  requester_name text;
  req_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

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

  select * into c
  from public.circles
  where invite_code_hash = encode(digest(upper(trim(code)), 'sha256'), 'hex')
    and invite_code_expires_at > now();

  if c.id is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  if exists (select 1 from public.circle_members where circle_id = c.id and user_id = auth.uid()) then
    return jsonb_build_object('status', 'joined', 'circle_id', c.id);
  end if;

  if not c.require_approval then
    insert into public.circle_members (circle_id, user_id) values (c.id, auth.uid())
    on conflict do nothing;
    return jsonb_build_object('status', 'joined', 'circle_id', c.id);
  end if;

  -- Approval required: record (or keep) a pending request and tell the
  -- creator. A repeat attempt while one is already pending doesn't
  -- re-notify.
  insert into public.join_requests (circle_id, user_id)
  values (c.id, auth.uid())
  on conflict (circle_id, user_id) where status = 'pending' do nothing
  returning id into req_id;

  if req_id is not null then
    select full_name into requester_name from public.profiles where id = auth.uid();
    perform public.send_alert_push(
      array[c.created_by],
      '👋 ' || requester_name || ' wants to join ' || c.name,
      'Open Safe Circle → Settings to approve or deny.',
      jsonb_build_object('type', 'join_request', 'circleId', c.id)
    );
  end if;

  return jsonb_build_object('status', 'pending', 'circle_id', c.id, 'circle_name', c.name);
end;
$$;

create function public.decide_join_request(p_request_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.join_requests;
  circle_name text;
begin
  select * into r from public.join_requests where id = p_request_id and status = 'pending';
  if not found then
    raise exception 'This request was already handled.';
  end if;
  if not public.is_circle_creator(r.circle_id) then
    raise exception 'Only the circle''s creator can decide this.';
  end if;

  update public.join_requests
  set status = case when p_approve then 'approved' else 'denied' end,
      decided_at = now(), decided_by = auth.uid()
  where id = r.id;

  select name into circle_name from public.circles where id = r.circle_id;

  if p_approve then
    insert into public.circle_members (circle_id, user_id) values (r.circle_id, r.user_id)
    on conflict do nothing;
  end if;

  perform public.send_alert_push(
    array[r.user_id],
    case when p_approve then '✅ You''re in: ' || circle_name else 'Request declined: ' || circle_name end,
    case when p_approve then 'Open Safe Circle to see your circle.' else 'The creator didn''t approve your request.' end,
    jsonb_build_object('type', 'join_decision', 'circleId', r.circle_id)
  );
end;
$$;

revoke all on function public.is_circle_creator(uuid) from public, anon;
revoke all on function public.set_circle_approval(uuid, boolean) from public, anon;
revoke all on function public.join_with_code(text) from public, anon;
revoke all on function public.decide_join_request(uuid, boolean) from public, anon;
grant execute on function public.is_circle_creator(uuid) to authenticated;
grant execute on function public.set_circle_approval(uuid, boolean) to authenticated;
grant execute on function public.join_with_code(text) to authenticated;
grant execute on function public.decide_join_request(uuid, boolean) to authenticated;

alter publication supabase_realtime add table public.join_requests;
