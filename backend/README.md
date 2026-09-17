# Safe Circle — Backend

Backend & data layer for the Safe Circle capstone project (Team Beacon).
Built on [Supabase](https://supabase.com): hosted Postgres, auth, and realtime —
no custom server to run or deploy.

## Schema

Four tables, per the proposal:

| Table            | Purpose                                                            |
|-------------------|---------------------------------------------------------------------|
| `profiles`        | One row per user, mirrors `auth.users`. Created automatically on sign-up. |
| `circles`         | A private group. Stores only a **hash** of its invite code, never the plaintext. |
| `circle_members`  | Join table: who belongs to which circle.                          |
| `locations`       | Append-only location pings (lat/lng/accuracy/battery/timestamp). One row per update. |

`latest_locations` is a view over `locations` (distinct-on latest row per user) for the live map to query instead of re-deriving "most recent" client-side.

Plus the geofencing/notifications stretch goal:

| Table                     | Purpose                                                             |
|---------------------------|----------------------------------------------------------------------|
| `places`                  | A named geofence (lat/lng/radius) inside a circle, e.g. "School".   |
| `place_membership_state`  | Bookkeeping: is this user currently inside this place? Lets us detect a transition instead of re-alerting on every ping. |
| `geofence_events`         | Log of `arrived`/`left` transitions. Written only by a trigger.     |
| `push_tokens`             | Expo/FCM push tokens per user/device.                               |

Plus the SOS button:

| Table         | Purpose                                                                     |
|---------------|-------------------------------------------------------------------------------|
| `sos_events`  | One tap = one row with your location. Not circle-scoped (same rule as `locations`) — visible to anyone who shares a circle with you. `resolved_at`/`resolved_by` track who cleared it. |

## How access control works

Row-level security is the enforcement point, not application code:

- **Locations**: you can always write your own position. You can only *read*
  someone else's position if `circle_members` shows you share a circle with
  them (checked via the `shares_circle_with()` helper function).
- **Circles / circle_members**: visible only to members of that circle
  (`is_member_of()` helper). Leaving is a normal delete of your own
  membership row (`circle_members_delete_self`); a circle's creator can
  additionally remove *someone else's* row (`circle_members_delete_by_creator`,
  `...000014_circle_members_creator_removal.sql`) but not their own through
  that path — self-removal for a creator goes through Leave/Delete-circle
  instead, since dropping their own membership would make `is_member_of()`
  (and so `circles_select_members`) stop returning the circle to them at
  all, permanently orphaning it from their own view.
- **Joining a circle never happens via a raw INSERT.** It goes through two
  `security definer` RPCs so a client can never forge membership or brute-force
  invite codes against the table directly:
  - `create_circle(circle_name text)` — creates a circle, generates + hashes a
    6-character invite code, adds the caller as the first member, and returns
    the plaintext code **once** (it's never stored or retrievable again — if
    it's lost, regenerate a new circle or add a `regenerate_invite_code` RPC
    later).
  - `redeem_invite_code(code text)` — hashes the submitted code, looks up the
    matching circle, and enrolls the caller. Codes expire after 48h
    (`invite_code_expires_at`), and each user is capped at 10 redemption
    attempts per rolling 15-minute window (`invite_redemption_attempts`) —
    added after a security review found the original version had neither,
    leaving it open to brute-forcing the 6-character code. An invalid or
    expired code returns `null` rather than throwing, deliberately: a
    thrown exception aborts the whole call's transaction, which would also
    undo that same call's attempt-counter update, and a wrong code is
    exactly what a brute-force guess looks like — raising here silently
    defeated the rate limit (caught by testing: 12 wrong guesses left the
    counter table empty). Callers should treat a `null` return as
    "invalid code," not rely on `error`.

This mirrors the proposal's security section (page 4/5 of the proposal):
"access is enforced in the database" and "hashed invite codes."

Geofence detection itself needs no Edge Function or cron job — a trigger
(`evaluate_geofences()`) runs after every `locations` insert, checks the
reporting user's position against every place in their circles, and on an
inside/outside transition writes a row to `geofence_events`, which a
second trigger (`notify_geofence_event`, migration `...000007`) turns into
an HTTP call via the `pg_net` extension to the `send-geofence-push` Edge
Function — that's the part that actually talks to Expo/FCM.

This is wired with `pg_net` directly rather than Supabase's Dashboard
"Database Webhooks" UI, because that UI depends on an internal
`supabase_functions` schema that isn't provisioned on every project
(hit this as `ERROR: 3F000: schema "supabase_functions" does not exist`
when first setting this up). The `pg_net` approach is equivalent but
lives entirely in a migration instead of a manual dashboard step — just
make sure the `pg_net` extension is enabled (migration `...000007` does
this with `create extension if not exists pg_net;`).

**The webhook call is authenticated**, not just JWT-shaped. A security
review caught that the Edge Function originally trusted its request body
outright: its `verify_jwt` setting only checks that *some* valid Supabase
JWT was presented, and the public anon key (embedded in every client)
satisfies that trivially — nothing verified the call actually came from
our own trigger. Migration `...000009` closes this: it generates a random
shared secret via Supabase Vault (`vault.create_secret`, value never
written in plaintext to any git-tracked file), the trigger sends it as an
`X-Webhook-Secret` header, and the function now rejects anything that
doesn't match (`send-geofence-push/index.ts`).

## Environment variables

Two `.env.example` files, for two different audiences:

- [`.env.example`](../.env.example) (repo root) — client-safe
  `SUPABASE_URL` / anon key for **Avi (mobile)** and **Thi (web)**. Safe to
  put in a client bundle; RLS is what actually protects the data.
- [`backend/.env.example`](.env.example) — used only by Surendra to `supabase
  link` this folder and to deploy the Edge Function's secrets. The
  `service_role` key **must never** reach a client or get committed.

Copy each to `.env` (already gitignored) and fill in real values from
Project Settings → API once the Supabase project exists.

## Running locally

Requires the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
supabase start          # boots local Postgres/Auth/Realtime/Studio in Docker
supabase db reset       # applies all migrations + seed.sql from scratch
```

Studio (table editor, SQL editor, auth users) runs at http://localhost:54323
once `supabase start` finishes.

## Deploying

```bash
supabase link --project-ref <your-project-ref>
supabase db push         # applies migrations to the hosted project, including the pg_net trigger

# Push notifications (stretch goal):
supabase functions deploy send-geofence-push
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` don't need to be set as
Edge Function secrets — Supabase injects both automatically for every
project (`supabase secrets list` will show them already present).

**One extra one-time step for `GEOFENCE_WEBHOOK_SECRET`**, needed only
the *first* time you push these migrations to a given project (already
done for our shared hosted project — skip this if you're just pulling
latest and pushing more migrations to the same project):

```bash
# 1. Push migrations 000009-000010 (NOT 000011 yet — see note below),
#    which generates the secret in Vault and creates a locked-down,
#    service_role-only accessor for it.
# 2. Read it out and mirror it into the Edge Function's env:
SECRET=$(curl -s -X POST "https://<ref>.supabase.co/rest/v1/rpc/_read_geofence_webhook_secret" \
  -H "apikey: <service-role-key>" -H "Authorization: Bearer <service-role-key>" \
  -H "Content-Type: application/json" -d '{}' | tr -d '"')
supabase secrets set "GEOFENCE_WEBHOOK_SECRET=$SECRET"
supabase functions deploy send-geofence-push
# 3. Only now push migration 000011, which drops the accessor entirely.
```

If you `supabase db push` all pending migrations at once on a brand-new
project, 000011 drops the accessor in the same batch as 000009 creates
it — before you get a chance to read the secret out. For a fresh project,
apply through 000010 first, do the sync above, then apply 000011.

Give the mobile app and web dashboard the project's `SUPABASE_URL` and
`SUPABASE_ANON_KEY` (Project Settings → API) via the root `.env.example`.
Never ship the `service_role` key to a client — it bypasses RLS entirely.

## Example usage (client SDK)

```ts
// Create a circle
const { data, error } = await supabase.rpc('create_circle', { circle_name: 'The Smiths' });
// data: [{ circle_id, invite_code }] — show invite_code to the user once.

// Join a circle — check `data`, not just `error`: an invalid/expired
// code returns null rather than throwing (see the RLS section above).
const { data: joinedCircleId, error: joinError } = await supabase
  .rpc('redeem_invite_code', { code: 'AB12CD' });
if (joinError) { /* e.g. rate-limited */ }
if (!joinedCircleId) { /* invalid or expired code */ }

// Report a location ping
await supabase.from('locations').insert({
  latitude, longitude, accuracy, battery_level,
});

// Subscribe to the live map
supabase
  .channel('locations-feed')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'locations' }, handleNewPing)
  .subscribe();

// Create a geofenced place (any circle member can)
await supabase.from('places').insert({
  circle_id, name: 'School', latitude, longitude, radius_meters: 150,
});

// Register this device for push notifications (call after Expo/FCM gives you a token)
await supabase.from('push_tokens').upsert({ token: expoPushToken, platform: 'ios' });

// See who's currently inside a place, and the arrive/leave history
await supabase.from('place_membership_state').select('*').eq('place_id', placeId);
await supabase.from('geofence_events').select('*').eq('place_id', placeId).order('occurred_at', { ascending: false });
```

## Everything from the proposal is built

All of the MVP (page 3) and all three stretch goals — geofenced places
with arrive/leave alerts, location history, and the SOS button — are
implemented, backend through UI, and verified against the real hosted
project rather than just written:

- **SOS button** — `sos_events` (not circle-scoped, same pattern as
  `locations`/`profiles`: visibility is "you, or anyone who shares a
  circle with you," via `shares_circle_with()`). One tap
  (`mobile/components/SosButton.tsx`) inserts a row with your current
  location; `notify_sos_event()` (migration `...000012`) fires the same
  pg_net + Vault-secret pattern as the geofence webhook, reusing the same
  `geofence_webhook_secret` rather than minting a second one, to the
  `send-sos-push` Edge Function, which notifies everyone across every
  circle you're in. Any circle member (or you) can mark it resolved
  (`mobile/components/SosBanner.tsx`), which is live via realtime. Capped
  at 3 alerts per 10 minutes per user (migration `...000013`) — a
  follow-up security pass caught that the first version had no limit,
  letting a buggy or malicious client spam a family and drain the Expo
  push quota. Enforced with a `before insert` trigger that counts
  existing rows rather than a mutable counter, sidestepping the exact
  rollback pitfall the invite-code rate limit hit (see below).
- **Location history** — `mobile/app/(app)/member/[userId].tsx` (tap a
  member on the Members tab) shows their last 100 pings as a map trail
  (list-only on web — `react-native-maps` has no web renderer, see
  `[userId].web.tsx`). No backend changes needed; `locations` was already
  append-only, so this is purely a new read.
- **Geofencing** — see the "How access control works" section above.

Caught one real bug building SOS: `sos_events` has two foreign keys to
`profiles` (`user_id` and `resolved_by`), so PostgREST couldn't
auto-resolve `profiles(full_name)` embeds (`PGRST201`, "more than one
relationship was found") until the query specified
`profiles!sos_events_user_id_fkey(full_name)`.
