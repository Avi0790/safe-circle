-- Guest tracking links: share your live location with someone who doesn't
-- have Safe Circle — a grandparent, a friend picking you up, a driver —
-- through a link that works in any browser and expires on its own. Life360
-- requires everyone to install the app and join the circle; this is the
-- "share my trip" case without that.
--
-- The link is a random 192-bit token, stored only as a hash (like invite
-- codes), shown once when created. Anyone holding it can see your latest
-- location until it expires or you revoke it — nothing else: no history,
-- no circle, and only your first name.
create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  -- Transparency, in the spirit of "who's checked on me": how many
  -- separate visits the link has had, and the last one. A visit is a
  -- session, not every 15-second refresh (see get_shared_location).
  view_count int not null default 0,
  last_viewed_at timestamptz
);

create index share_links_user_idx on public.share_links (user_id, created_at desc);

alter table public.share_links enable row level security;

-- You can see your own links (including the counters); no direct writes.
create policy "share_links_select_own"
  on public.share_links for select
  using (user_id = auth.uid());

create function public.create_share_link(p_minutes int)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  token text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_minutes is null or p_minutes < 15 or p_minutes > 1440 then
    raise exception 'Choose between 15 minutes and 24 hours.';
  end if;
  if (select count(*) from public.share_links
      where user_id = auth.uid() and revoked_at is null and expires_at > now()) >= 5 then
    raise exception 'You already have 5 active links. Revoke one first.';
  end if;

  token := encode(gen_random_bytes(24), 'hex');
  insert into public.share_links (user_id, token_hash, expires_at)
  values (auth.uid(), encode(digest(token, 'sha256'), 'hex'), now() + make_interval(mins => p_minutes));

  -- Returned exactly once — only the hash is stored.
  return token;
end;
$$;

create function public.revoke_share_link(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.share_links set revoked_at = now()
  where id = p_id and user_id = auth.uid() and revoked_at is null;
end;
$$;

-- The public read. Callable by anyone holding a token (anon included —
-- that's the whole point), so it is deliberately narrow: returns one row
-- with the latest location and a first name, or nothing for an unknown,
-- expired or revoked token (no distinguishing between those — nothing for
-- a guesser to learn from). A 192-bit token can't be guessed, so there is
-- no attempt counter here, unlike the 30-bit invite codes.
create function public.get_shared_location(p_token text)
returns table (
  first_name text,
  latitude double precision,
  longitude double precision,
  accuracy double precision,
  speed real,
  battery_level real,
  recorded_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  link public.share_links;
begin
  select * into link
  from public.share_links
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and revoked_at is null
    and share_links.expires_at > now();

  if link.id is null then
    return;
  end if;

  -- Count a visit at most once per 5 minutes, so the page's periodic
  -- refresh doesn't read as hundreds of separate views.
  if link.last_viewed_at is null or link.last_viewed_at < now() - interval '5 minutes' then
    update public.share_links
    set view_count = view_count + 1, last_viewed_at = now()
    where id = link.id;
  end if;

  return query
  select split_part(p.full_name, ' ', 1), l.latitude, l.longitude, l.accuracy::double precision,
         l.speed, l.battery_level::real, l.recorded_at, link.expires_at
  from public.profiles p
  left join lateral (
    select * from public.locations where user_id = p.id order by recorded_at desc limit 1
  ) l on true
  where p.id = link.user_id;
end;
$$;

revoke all on function public.create_share_link(int) from public, anon;
revoke all on function public.revoke_share_link(uuid) from public, anon;
revoke all on function public.get_shared_location(text) from public;
grant execute on function public.create_share_link(int) to authenticated;
grant execute on function public.revoke_share_link(uuid) to authenticated;
grant execute on function public.get_shared_location(text) to anon, authenticated;
