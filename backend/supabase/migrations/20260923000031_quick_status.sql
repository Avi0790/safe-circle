-- Quick status: a short "On my way" / "Studying" / "Need pickup" chip next
-- to your name, instead of a circle-mate having to guess from a dot on a
-- map. Self-expires so it can't go stale forever like a bio would.
alter table public.profiles add column status_emoji text;
alter table public.profiles add column status_text text;
alter table public.profiles add column status_expires_at timestamptz;

create function public.set_status(p_emoji text, p_text text, p_minutes int default 240)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_text is not null and length(p_text) > 40 then
    raise exception 'Keep it under 40 characters.';
  end if;
  if p_minutes is null or p_minutes <= 0 or p_minutes > 1440 then
    raise exception 'A status lasts up to 24 hours.';
  end if;

  update public.profiles
  set status_emoji = p_emoji,
      status_text = nullif(trim(p_text), ''),
      status_expires_at = now() + make_interval(mins => p_minutes)
  where id = auth.uid();
end;
$$;

create function public.clear_status()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set status_emoji = null, status_text = null, status_expires_at = null
  where id = auth.uid();
end;
$$;

revoke all on function public.set_status(text, text, int) from public, anon;
revoke all on function public.clear_status() from public, anon;
grant execute on function public.set_status(text, text, int) to authenticated;
grant execute on function public.clear_status() to authenticated;
